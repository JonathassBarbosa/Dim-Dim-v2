begin;

create extension if not exists pgcrypto;

create type public.transaction_type as enum ('income', 'expense', 'transfer');
create type public.account_type as enum ('checking', 'savings', 'cash', 'digital_wallet', 'investment', 'other');
create type public.budget_period as enum ('monthly', 'yearly');
create type public.installment_status as enum ('pending', 'paid', 'overdue', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  currency char(3) not null default 'BRL',
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  hide_balance boolean not null default false,
  ai_voice boolean not null default false,
  notifications_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type public.account_type not null default 'checking',
  institution text,
  initial_balance numeric(14,2) not null default 0,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  brand text,
  last_four char(4),
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  group_name text not null default 'Necessidade'
    check (group_name in ('Necessidade', 'Desejo', 'Investimento')),
  icon text,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  transfer_account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  type public.transaction_type not null,
  description text,
  occurred_at timestamptz not null default now(),
  payment_method text,
  total numeric(14,2) not null check (total >= 0),
  latitude numeric(9,6),
  longitude numeric(9,6),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  subtotal numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  in_shopping_list boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.credit_card_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  reference_month date not null check (reference_month = date_trunc('month', reference_month)::date),
  closing_date date not null,
  due_date date not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, credit_card_id, reference_month)
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  installment_number smallint not null check (installment_number > 0),
  installment_count smallint not null check (installment_count > 0),
  amount numeric(14,2) not null check (amount >= 0),
  due_date date not null,
  status public.installment_status not null default 'pending',
  paid_at timestamptz,
  unique(transaction_id, installment_number),
  check (installment_number <= installment_count)
);

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  period public.budget_period not null default 'monthly',
  amount numeric(14,2) not null default 0 check (amount >= 0),
  starts_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category_id, period)
);

create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('once', 'weekly', 'monthly', 'yearly')),
  next_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  type text not null default 'Outro',
  institution text,
  invested_value numeric(14,2) not null default 0 check (invested_value >= 0),
  current_value numeric(14,2) not null default 0 check (current_value >= 0),
  annual_rate numeric(8,4),
  maturity_date date,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  expected_price numeric(14,2) not null default 0 check (expected_price >= 0),
  checked boolean not null default true,
  times_used integer not null default 0 check (times_used >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  ocr_text text,
  created_at timestamptz not null default now(),
  unique(user_id, storage_path)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index transactions_user_occurred_idx on public.transactions(user_id, occurred_at desc);
create index transaction_items_transaction_idx on public.transaction_items(transaction_id);
create index installments_user_due_idx on public.installments(user_id, due_date);
create index recurring_expenses_user_due_idx on public.recurring_expenses(user_id, next_due_date);
create index shopping_list_user_position_idx on public.shopping_list_items(user_id, position);
create index audit_logs_user_created_idx on public.audit_logs(user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_settings', 'accounts', 'credit_cards', 'transactions',
    'credit_card_invoices', 'recurring_expenses', 'budgets', 'income_sources',
    'investments', 'shopping_list_items'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  insert into public.user_settings (user_id) values (new.id);
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

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.save_purchase(
  p_purchase_id uuid,
  p_occurred_at timestamptz,
  p_payment_method text,
  p_total numeric,
  p_latitude numeric,
  p_longitude numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  saved_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação obrigatória';
  end if;

  insert into public.transactions (
    id, user_id, type, occurred_at, payment_method, total, latitude, longitude
  ) values (
    p_purchase_id, (select auth.uid()), 'expense', p_occurred_at,
    p_payment_method, p_total, p_latitude, p_longitude
  )
  on conflict (id) do update set
    occurred_at = excluded.occurred_at,
    payment_method = excluded.payment_method,
    total = excluded.total,
    latitude = excluded.latitude,
    longitude = excluded.longitude
  where public.transactions.user_id = (select auth.uid())
  returning id into saved_id;

  if saved_id is null then
    raise exception 'Compra não encontrada';
  end if;

  delete from public.transaction_items
  where transaction_id = saved_id and user_id = (select auth.uid());

  for item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.transaction_items (
      user_id, transaction_id, category_id, name, quantity, unit_price,
      in_shopping_list
    ) values (
      (select auth.uid()),
      saved_id,
      (
        select id from public.categories
        where user_id = (select auth.uid())
          and lower(name) = lower(coalesce(item ->> 'category', 'Outros'))
        limit 1
      ),
      item ->> 'name',
      greatest(coalesce((item ->> 'qty')::numeric, 1), 0.001),
      greatest(coalesce((item ->> 'price')::numeric, 0), 0),
      coalesce((item ->> 'inList')::boolean, true)
    );
  end loop;

  return saved_id;
end;
$$;

create or replace function public.delete_purchase(p_purchase_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.transactions
  where id = p_purchase_id and user_id = (select auth.uid());
  return found;
end;
$$;

grant execute on function public.save_purchase(uuid, timestamptz, text, numeric, numeric, numeric, jsonb) to authenticated;
grant execute on function public.delete_purchase(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.accounts enable row level security;
alter table public.credit_cards enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.credit_card_invoices enable row level security;
alter table public.installments enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.budgets enable row level security;
alter table public.income_sources enable row level security;
alter table public.investments enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.receipts enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare table_name text;
declare owner_column text;
begin
  foreach table_name in array array[
    'user_settings', 'accounts', 'credit_cards', 'categories', 'transactions',
    'transaction_items', 'credit_card_invoices', 'installments',
    'recurring_expenses', 'budgets', 'income_sources', 'investments',
    'shopping_list_items', 'receipts', 'audit_logs'
  ]
  loop
    execute format(
      'create policy "own rows only" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end $$;

create policy "own profile only" on public.profiles
for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "receipt files owned by user" on storage.objects
for all to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
