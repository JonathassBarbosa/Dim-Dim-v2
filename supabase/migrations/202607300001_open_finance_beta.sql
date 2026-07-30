begin;

alter table public.profiles
  add column if not exists profile_type text not null default 'personal'
    check (profile_type in ('personal', 'business')),
  add column if not exists document_type text
    check (document_type is null or document_type in ('cpf', 'cnpj')),
  add column if not exists document_hash text,
  add column if not exists document_last_four char(4),
  add column if not exists phone text,
  add column if not exists birth_date date,
  add column if not exists state char(2),
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists open_finance_beta_accepted_at timestamptz;

create table if not exists public.financial_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'pluggy' check (provider in ('pluggy')),
  provider_item_id text not null,
  institution_name text,
  connector_id text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'updating', 'error', 'revoked', 'deleted')),
  execution_status text,
  error_code text,
  error_message text,
  last_synced_at timestamptz,
  consent_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_item_id)
);

create table if not exists public.open_finance_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid references public.financial_connections(id) on delete set null,
  provider text not null default 'pluggy' check (provider in ('pluggy')),
  consent_type text not null default 'data_sharing'
    check (consent_type in ('data_sharing')),
  status text not null default 'granted'
    check (status in ('pending', 'granted', 'expired', 'revoked')),
  products text[] not null default array['accounts', 'transactions', 'credit_cards']::text[],
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  terms_version text not null,
  privacy_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider, consent_type, terms_version, privacy_version)
);

create table if not exists public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null references public.financial_connections(id) on delete cascade,
  provider_account_id text not null,
  local_account_id uuid references public.accounts(id) on delete set null,
  type text,
  subtype text,
  name text not null,
  institution text,
  balance numeric(14,2),
  currency char(3) not null default 'BRL',
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, provider_account_id)
);

create table if not exists public.external_credit_card_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null references public.financial_connections(id) on delete cascade,
  provider_bill_id text not null,
  provider_account_id text,
  local_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  due_date date,
  closing_date date,
  total_amount numeric(14,2),
  minimum_payment numeric(14,2),
  status text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, provider_bill_id)
);

create table if not exists public.external_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null references public.financial_connections(id) on delete cascade,
  external_account_id uuid references public.external_accounts(id) on delete set null,
  provider_transaction_id text not null,
  transaction_id uuid references public.transactions(id) on delete set null,
  description text,
  amount numeric(14,2) not null,
  occurred_at timestamptz not null,
  category text,
  payment_data jsonb not null default '{}'::jsonb,
  merchant jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, provider_transaction_id)
);

create table if not exists public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'pluggy' check (provider in ('pluggy')),
  provider_event_id text not null,
  event_type text not null,
  provider_item_id text,
  user_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, provider_event_id)
);

create index if not exists financial_connections_user_idx
  on public.financial_connections(user_id, status);
create index if not exists open_finance_consents_user_idx
  on public.open_finance_consents(user_id, status);
create index if not exists external_accounts_user_idx
  on public.external_accounts(user_id, connection_id);
create index if not exists external_bills_user_due_idx
  on public.external_credit_card_bills(user_id, due_date);
create index if not exists external_transactions_user_date_idx
  on public.external_transactions(user_id, occurred_at desc);
create index if not exists provider_webhook_events_status_idx
  on public.provider_webhook_events(processing_status, received_at);

drop trigger if exists financial_connections_set_updated_at on public.financial_connections;
create trigger financial_connections_set_updated_at
before update on public.financial_connections
for each row execute function public.set_updated_at();

drop trigger if exists open_finance_consents_set_updated_at on public.open_finance_consents;
create trigger open_finance_consents_set_updated_at
before update on public.open_finance_consents
for each row execute function public.set_updated_at();

drop trigger if exists external_accounts_set_updated_at on public.external_accounts;
create trigger external_accounts_set_updated_at
before update on public.external_accounts
for each row execute function public.set_updated_at();

drop trigger if exists external_credit_card_bills_set_updated_at on public.external_credit_card_bills;
create trigger external_credit_card_bills_set_updated_at
before update on public.external_credit_card_bills
for each row execute function public.set_updated_at();

drop trigger if exists external_transactions_set_updated_at on public.external_transactions;
create trigger external_transactions_set_updated_at
before update on public.external_transactions
for each row execute function public.set_updated_at();

alter table public.financial_connections enable row level security;
alter table public.open_finance_consents enable row level security;
alter table public.external_accounts enable row level security;
alter table public.external_credit_card_bills enable row level security;
alter table public.external_transactions enable row level security;
alter table public.provider_webhook_events enable row level security;

create policy "own connections only" on public.financial_connections
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own consents only" on public.open_finance_consents
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own external accounts only" on public.external_accounts
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own external bills only" on public.external_credit_card_bills
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own external transactions only" on public.external_transactions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Sem política para usuários: eventos brutos de webhook são exclusivos do backend/service_role.

create or replace function public.save_open_finance_profile(
  p_name text,
  p_profile_type text,
  p_document text,
  p_phone text,
  p_birth_date date,
  p_state text,
  p_accept_terms boolean,
  p_accept_privacy boolean,
  p_accept_open_finance_beta boolean
)
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_document text := regexp_replace(coalesce(p_document, ''), '\D', '', 'g');
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  saved_profile public.profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação obrigatória';
  end if;
  if p_profile_type not in ('personal', 'business') then
    raise exception 'Tipo de perfil inválido';
  end if;
  if length(normalized_document) not in (11, 14) then
    raise exception 'CPF ou CNPJ inválido';
  end if;
  if length(normalized_phone) < 10 or length(normalized_phone) > 13 then
    raise exception 'Telefone inválido';
  end if;
  if not p_accept_terms or not p_accept_privacy or not p_accept_open_finance_beta then
    raise exception 'É necessário aceitar os termos e consentimentos';
  end if;

  update public.profiles
  set
    name = trim(coalesce(p_name, '')),
    profile_type = p_profile_type,
    document_type = case when length(normalized_document) = 11 then 'cpf' else 'cnpj' end,
    document_hash = encode(public.digest(normalized_document, 'sha256'), 'hex'),
    document_last_four = right(normalized_document, 4),
    phone = normalized_phone,
    birth_date = p_birth_date,
    state = upper(trim(p_state)),
    onboarding_completed_at = coalesce(onboarding_completed_at, now()),
    terms_accepted_at = coalesce(terms_accepted_at, now()),
    privacy_accepted_at = coalesce(privacy_accepted_at, now()),
    open_finance_beta_accepted_at = coalesce(open_finance_beta_accepted_at, now())
  where id = (select auth.uid())
  returning * into saved_profile;

  return saved_profile;
end;
$$;

grant execute on function public.save_open_finance_profile(
  text, text, text, text, date, text, boolean, boolean, boolean
) to authenticated;

create or replace function public.open_finance_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
select jsonb_build_object(
  'connected', exists (
    select 1 from public.financial_connections
    where user_id = (select auth.uid()) and status in ('active', 'updating')
  ),
  'bankBalance', coalesce((
    select round(sum(balance), 2)
    from public.external_accounts
    where user_id = (select auth.uid()) and type = 'BANK'
  ), 0),
  'creditCardBalance', coalesce((
    select round(sum(balance), 2)
    from public.external_accounts
    where user_id = (select auth.uid()) and type = 'CREDIT'
  ), 0),
  'upcomingBills', coalesce((
    select jsonb_agg(jsonb_build_object(
      'institution', c.institution_name,
      'dueDate', b.due_date,
      'amount', round(b.total_amount, 2),
      'status', b.status
    ) order by b.due_date)
    from public.external_credit_card_bills b
    join public.financial_connections c on c.id = b.connection_id
    where b.user_id = (select auth.uid())
      and b.due_date >= (now() at time zone 'America/Sao_Paulo')::date
      and b.due_date < ((now() at time zone 'America/Sao_Paulo')::date + 45)
  ), '[]'::jsonb),
  'lastSyncedAt', (
    select max(last_synced_at)
    from public.financial_connections
    where user_id = (select auth.uid())
  )
);
$$;

grant execute on function public.open_finance_summary() to authenticated;

commit;
