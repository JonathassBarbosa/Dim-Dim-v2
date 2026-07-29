begin;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  in_app_enabled boolean not null default true,
  push_enabled boolean not null default false,
  daily_tip_enabled boolean not null default true,
  low_balance_enabled boolean not null default true,
  budget_alert_enabled boolean not null default true,
  bill_due_enabled boolean not null default true,
  daily_tip_time time not null default '08:00',
  low_balance_threshold numeric(14,2) not null default 100 check (low_balance_threshold >= 0),
  timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('daily_tip', 'low_balance', 'budget', 'bill_due', 'system')),
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  data jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  scheduled_for timestamptz not null default now(),
  read_at timestamptz,
  push_sent_at timestamptz,
  push_attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  monthly_contribution numeric(14,2) not null default 0 check (monthly_contribution >= 0),
  target_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index notifications_pending_push_idx
  on public.notifications(scheduled_for)
  where push_sent_at is null and push_attempts < 5;
create index push_subscriptions_user_active_idx
  on public.push_subscriptions(user_id, active);
create index financial_goals_user_active_idx
  on public.financial_goals(user_id, active);

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

create trigger financial_goals_set_updated_at
before update on public.financial_goals
for each row execute function public.set_updated_at();

insert into public.notification_preferences (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  insert into public.user_settings (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);
  insert into public.categories (user_id, name, group_name) values
    (new.id, 'Alimentação', 'Necessidade'),
    (new.id, 'Moradia', 'Necessidade'),
    (new.id, 'Transporte', 'Necessidade'),
    (new.id, 'Lazer', 'Desejo'),
    (new.id, 'Investimentos', 'Investimento'),
    (new.id, 'Outros', 'Necessidade');
  return new;
end;
$$;

create or replace function public.financial_summary_for_user(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with clock as (
  select
    (now() at time zone 'America/Sao_Paulo')::date as today,
    date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as month_start,
    (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month')::date as month_end
),
recorded as (
  select
    coalesce(sum(t.total) filter (where t.type = 'income'), 0)::numeric as income,
    coalesce(sum(t.total) filter (where t.type = 'expense'), 0)::numeric as spent
  from public.transactions t, clock c
  where t.user_id = p_user_id
    and (t.occurred_at at time zone 'America/Sao_Paulo')::date >= c.month_start
    and (t.occurred_at at time zone 'America/Sao_Paulo')::date < c.month_end
),
planned_income as (
  select coalesce(sum(
    case i.frequency
      when 'weekly' then i.amount * 52 / 12
      when 'yearly' then i.amount / 12
      when 'once' then case
        when i.next_date >= c.month_start and i.next_date < c.month_end then i.amount
        else 0
      end
      else i.amount
    end
  ), 0)::numeric as amount
  from public.income_sources i, clock c
  where i.user_id = p_user_id and i.active
),
fixed_commitments as (
  select coalesce(sum(
    case r.frequency
      when 'weekly' then r.amount * 52 / 12
      when 'quarterly' then r.amount / 3
      when 'yearly' then r.amount / 12
      else r.amount
    end
  ), 0)::numeric as amount
  from public.recurring_expenses r
  where r.user_id = p_user_id and r.active
),
pending_installments as (
  select coalesce(sum(i.amount), 0)::numeric as amount
  from public.installments i, clock c
  where i.user_id = p_user_id
    and i.status in ('pending', 'overdue')
    and i.due_date >= c.today
    and i.due_date < c.month_end
),
goal_reserve as (
  select coalesce(sum(g.monthly_contribution), 0)::numeric as amount
  from public.financial_goals g
  where g.user_id = p_user_id and g.active
),
group_spending as (
  select
    coalesce(ca.group_name, 'Necessidade') as group_name,
    coalesce(sum(ti.subtotal), 0)::numeric as spent
  from public.transaction_items ti
  join public.transactions t on t.id = ti.transaction_id
  left join public.categories ca on ca.id = ti.category_id
  cross join clock c
  where ti.user_id = p_user_id
    and t.type = 'expense'
    and (t.occurred_at at time zone 'America/Sao_Paulo')::date >= c.month_start
    and (t.occurred_at at time zone 'America/Sao_Paulo')::date < c.month_end
  group by coalesce(ca.group_name, 'Necessidade')
),
group_budgets as (
  select ca.group_name, coalesce(sum(b.amount), 0)::numeric as budget
  from public.budgets b
  join public.categories ca on ca.id = b.category_id
  where b.user_id = p_user_id and b.period = 'monthly'
  group by ca.group_name
),
groups as (
  select
    names.group_name,
    coalesce(gs.spent, 0)::numeric as spent,
    coalesce(gb.budget, 0)::numeric as budget
  from (
    select unnest(array['Necessidade', 'Desejo', 'Investimento']) as group_name
  ) names
  left join group_spending gs using (group_name)
  left join group_budgets gb using (group_name)
),
totals as (
  select
    case when r.income > 0 then r.income else pi.amount end as income,
    r.spent,
    fc.amount as fixed_commitments,
    inst.amount as pending_installments,
    gr.amount as goal_reserve,
    greatest(
      (c.month_end - c.today),
      1
    )::integer as remaining_days,
    c.today,
    c.month_start,
    c.month_end
  from recorded r
  cross join planned_income pi
  cross join fixed_commitments fc
  cross join pending_installments inst
  cross join goal_reserve gr
  cross join clock c
),
calculated as (
  select
    *,
    (income - spent - fixed_commitments - pending_installments - goal_reserve)::numeric as available
  from totals
)
select jsonb_build_object(
  'income', round(c.income, 2),
  'spent', round(c.spent, 2),
  'fixedCommitments', round(c.fixed_commitments, 2),
  'pendingInstallments', round(c.pending_installments, 2),
  'goalReserve', round(c.goal_reserve, 2),
  'available', round(c.available, 2),
  'safeDaily', round(greatest(c.available, 0) / c.remaining_days, 2),
  'remainingDays', c.remaining_days,
  'referenceMonth', to_char(c.month_start, 'YYYY-MM'),
  'calculatedAt', now(),
  'groups', (
    select jsonb_agg(jsonb_build_object(
      'name', g.group_name,
      'spent', round(g.spent, 2),
      'budget', round(g.budget, 2),
      'percentage', case when g.budget > 0 then round(g.spent * 100 / g.budget, 1) else 0 end
    ) order by g.group_name)
    from groups g
  )
)
from calculated c;
$$;

revoke all on function public.financial_summary_for_user(uuid) from public, anon, authenticated;
grant execute on function public.financial_summary_for_user(uuid) to service_role;

create or replace function public.financial_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação obrigatória';
  end if;
  return public.financial_summary_for_user((select auth.uid()));
end;
$$;

grant execute on function public.financial_summary() to authenticated;

create or replace function public.generate_financial_notifications_for_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefs record;
  summary jsonb;
  local_today date;
  local_time time;
  inserted_count integer := 0;
  affected integer := 0;
  group_item jsonb;
  bill record;
  available numeric;
  safe_daily numeric;
begin
  select * into prefs
  from public.notification_preferences
  where user_id = p_user_id;

  if not found or not prefs.in_app_enabled then
    return 0;
  end if;

  local_today := (now() at time zone prefs.timezone)::date;
  local_time := (now() at time zone prefs.timezone)::time;
  summary := public.financial_summary_for_user(p_user_id);
  available := coalesce((summary ->> 'available')::numeric, 0);
  safe_daily := coalesce((summary ->> 'safeDaily')::numeric, 0);

  if prefs.daily_tip_enabled and local_time >= prefs.daily_tip_time then
    insert into public.notifications (
      user_id, type, title, body, severity, data, idempotency_key
    ) values (
      p_user_id,
      'daily_tip',
      'Seu limite seguro de hoje',
      case
        when available < 0 then
          'Seu mês está no negativo. Hoje, priorize apenas gastos essenciais.'
        else
          format('Para manter o plano do mês, tente gastar até R$ %s hoje.', replace(round(safe_daily, 2)::text, '.', ','))
      end,
      case when available < 0 then 'critical' else 'info' end,
      summary,
      'daily-tip:' || local_today::text
    )
    on conflict (user_id, idempotency_key) do nothing;
    get diagnostics affected = row_count;
    inserted_count := inserted_count + affected;
  end if;

  if prefs.low_balance_enabled and available <= prefs.low_balance_threshold then
    insert into public.notifications (
      user_id, type, title, body, severity, data, idempotency_key
    ) values (
      p_user_id,
      'low_balance',
      'Saldo livre baixo',
      format('Restam R$ %s livres neste mês. Evite gastos não essenciais.', replace(round(available, 2)::text, '.', ',')),
      case when available < 0 then 'critical' else 'warning' end,
      summary,
      'low-balance:' || local_today::text
    )
    on conflict (user_id, idempotency_key) do nothing;
    get diagnostics affected = row_count;
    inserted_count := inserted_count + affected;
  end if;

  if prefs.budget_alert_enabled then
    for group_item in
      select value from jsonb_array_elements(coalesce(summary -> 'groups', '[]'::jsonb))
    loop
      if coalesce((group_item ->> 'budget')::numeric, 0) > 0
        and coalesce((group_item ->> 'spent')::numeric, 0) >= (group_item ->> 'budget')::numeric
      then
        insert into public.notifications (
          user_id, type, title, body, severity, data, idempotency_key
        ) values (
          p_user_id,
          'budget',
          'Orçamento atingido',
          format(
            '%s chegou a %s%% da meta mensal.',
            group_item ->> 'name',
            group_item ->> 'percentage'
          ),
          'warning',
          group_item,
          'budget:' || (summary ->> 'referenceMonth') || ':' || (group_item ->> 'name')
        )
        on conflict (user_id, idempotency_key) do nothing;
        get diagnostics affected = row_count;
        inserted_count := inserted_count + affected;
      end if;
    end loop;
  end if;

  if prefs.bill_due_enabled then
    for bill in
      select id, name, amount, next_due_date
      from public.recurring_expenses
      where user_id = p_user_id
        and active
        and next_due_date between local_today and local_today + 3
    loop
      insert into public.notifications (
        user_id, type, title, body, severity, data, idempotency_key
      ) values (
        p_user_id,
        'bill_due',
        'Conta próxima do vencimento',
        format('%s, no valor de R$ %s, vence em %s.', bill.name, replace(round(bill.amount, 2)::text, '.', ','), to_char(bill.next_due_date, 'DD/MM')),
        'warning',
        jsonb_build_object('recurringExpenseId', bill.id, 'dueDate', bill.next_due_date),
        'bill:' || bill.id::text || ':' || bill.next_due_date::text
      )
      on conflict (user_id, idempotency_key) do nothing;
      get diagnostics affected = row_count;
      inserted_count := inserted_count + affected;
    end loop;
  end if;

  return inserted_count;
end;
$$;

revoke all on function public.generate_financial_notifications_for_user(uuid) from public, anon, authenticated;
grant execute on function public.generate_financial_notifications_for_user(uuid) to service_role;

create or replace function public.generate_financial_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação obrigatória';
  end if;
  return public.generate_financial_notifications_for_user((select auth.uid()));
end;
$$;

grant execute on function public.generate_financial_notifications() to authenticated;

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.financial_goals enable row level security;

create policy "own notification preferences"
on public.notification_preferences
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "read own notifications"
on public.notifications
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "update own notifications"
on public.notifications
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own push subscriptions"
on public.push_subscriptions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own financial goals"
on public.financial_goals
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
