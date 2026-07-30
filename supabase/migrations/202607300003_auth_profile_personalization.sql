create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    name,
    phone,
    terms_accepted_at,
    privacy_accepted_at
  )
  values (
    new.id,
    trim(coalesce(new.raw_user_meta_data ->> 'name', '')),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''),
    case when new.raw_user_meta_data ->> 'terms_version' is not null then now() end,
    case when new.raw_user_meta_data ->> 'privacy_version' is not null then now() end
  );

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
