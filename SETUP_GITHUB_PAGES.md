# Publicação gratuita: Supabase + GitHub Pages

## 1. Criar o banco

1. Crie um projeto no plano Free do Supabase.
2. Abra **SQL Editor**.
3. Execute `supabase/migrations/202607280001_initial_schema.sql`.
4. Em **Authentication → URL Configuration**, use como Site URL e Redirect URL:
   `https://jonathassbarbosa.github.io/Dim-Dim-v2/`.

## 2. Configurar o Gemini

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase secrets set GEMINI_API_KEY=SUA_CHAVE_NOVA
npx supabase functions deploy gemini
```

Use uma chave nova. A chave antiga exposta no histórico do Git deve ser
desativada no Google AI Studio.

## 3. Conectar o frontend

Informe no primeiro acesso a Project URL e a chave pública `anon`/publishable.
Alternativamente, defina os dois valores públicos em `js/config.js`. Não use a
chave `service_role`.

## 4. Publicar

Em **Settings → Pages**, escolha **Deploy from a branch**, selecione `main` e
`/ (root)`. Depois abra o aplicativo, crie a conta e confirme o e-mail.
