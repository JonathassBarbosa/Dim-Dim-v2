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
    document_hash = encode(extensions.digest(normalized_document, 'sha256'), 'hex'),
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
