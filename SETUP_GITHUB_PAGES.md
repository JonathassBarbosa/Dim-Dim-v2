# Publicação gratuita: Supabase + GitHub Pages

## 1. Criar o banco

1. Crie um projeto no plano Free do Supabase.
2. Abra **SQL Editor**.
3. Execute `supabase/migrations/202607280001_initial_schema.sql`.
4. Execute `supabase/migrations/202607290001_notifications.sql`.
5. Em **Authentication → URL Configuration**, use como Site URL e Redirect URL:
   `https://dimdim.smartservices.com.br/`.

## 2. Configurar o Gemini

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase secrets set GEMINI_API_KEY=SUA_CHAVE_NOVA
npx supabase functions deploy gemini
```

Use a chave Gemini configurada no Secret do Supabase. Ela nunca deve aparecer
no frontend ou em arquivos versionados.

## 3. Ativar as notificações

As notificações internas são liberadas pela segunda migração. Para receber com
o app fechado, conclua também `docs/WEB_PUSH_SETUP.md`.

## 4. Conectar o frontend

Informe no primeiro acesso a Project URL e a chave pública `anon`/publishable.
Alternativamente, defina os dois valores públicos em `js/config.js`. Não use a
chave `service_role`.

## 5. Publicar

Em **Settings → Pages**, escolha **Deploy from a branch**, selecione `main` e
`/ (root)`. Depois abra o aplicativo, crie a conta e confirme o e-mail.
