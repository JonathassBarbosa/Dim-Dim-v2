# Ativação das notificações e do Web Push

As notificações internas funcionam com o PostgreSQL. O Web Push acrescenta a
entrega mesmo quando o PWA está fechado.

## 1. Aplicar a migração

No **Supabase Dashboard → SQL Editor**, execute:

`supabase/migrations/202607290001_notifications.sql`

Ela cria preferências, notificações, inscrições de aparelhos, metas financeiras
e os cálculos seguros de saldo mensal.

## 2. Gerar as chaves VAPID

Execute uma única vez em um terminal seguro:

```bash
npx @pushforge/builder vapid
```

- A chave pública vai em `VAPID_PUBLIC_KEY` nos Secrets e também em
  `js/config.js`.
- A chave privada em formato JWK vai **somente** no Secret
  `VAPID_PRIVATE_KEY`.
- Nunca coloque a chave privada no GitHub, no frontend ou em uma conversa.

## 3. Configurar os Secrets

Em **Supabase Dashboard → Edge Functions → Secrets**, configure:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` com um contato, por exemplo `mailto:admin@seudominio.com`
- `CRON_SECRET` com um valor aleatório longo

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são disponibilizadas
automaticamente pelo ambiente da Edge Function.

## 4. Implantar a função

Implante `supabase/functions/notification-dispatch/index.ts` com a verificação de
JWT desativada. A chamada continua protegida pelo header `x-cron-secret`.

Com a CLI:

```bash
npx supabase functions deploy notification-dispatch --no-verify-jwt
```

## 5. Agendar a execução

Ative as extensões **pg_cron** e **pg_net**. Guarde no Vault o mesmo
`CRON_SECRET` configurado na Edge Function:

```sql
select vault.create_secret(
  'SUBSTITUA_PELO_MESMO_CRON_SECRET',
  'dimdim_cron_secret'
);
```

Depois agende a função de hora em hora:

```sql
select cron.schedule(
  'dimdim-notification-dispatch',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://bpoyfqojlhztqprpndla.supabase.co/functions/v1/notification-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'dimdim_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

O agendamento máximo necessário é horário: cada usuário escolhe o horário da
dica, e o banco garante que cada alerta seja criado apenas uma vez.

## Observação sobre iPhone e iPad

No iOS/iPadOS, o usuário deve instalar o PWA pela opção **Adicionar à Tela de
Início** antes de habilitar o Push. A permissão só é solicitada depois do toque
no botão dentro do app.
