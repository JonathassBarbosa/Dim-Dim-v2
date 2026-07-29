# DimDim — seu dinheiro, sem enrolação

PWA de finanças pessoais com PostgreSQL, autenticação, lista de compras, OCR,
painel 50-30-20 e assistente financeiro.

## Arquitetura de produção

- GitHub Pages hospeda o frontend estático.
- Supabase Auth autentica cada usuário.
- Supabase Postgres armazena os dados com Row Level Security (RLS).
- Supabase Storage guarda comprovantes em bucket privado.
- Supabase Edge Function chama o Gemini sem expor a chave.
- PostgreSQL calcula o valor livre, os compromissos e o limite diário.
- Uma central interna e Web Push entregam alertas financeiros.

O esquema em `supabase/migrations/202607280001_initial_schema.sql` inclui:
`profiles`, `user_settings`, `accounts`, `credit_cards`,
`credit_card_invoices`, `categories`, `budgets`, `transactions`,
`transaction_items`, `installments`, `recurring_expenses`, `income_sources`,
`investments`, `shopping_list_items`, `receipts` e `audit_logs`.

A migração `supabase/migrations/202607290001_notifications.sql` acrescenta
`notification_preferences`, `notifications`, `push_subscriptions` e
`financial_goals`, além das funções de resumo e geração de alertas.

## Publicação

Siga `SETUP_GITHUB_PAGES.md`. A URL do Supabase e a chave pública podem ser
preenchidas no primeiro acesso ou definidas em `js/config.js`. A chave pública
não é segredo; o acesso é protegido pelo login e por RLS.

Nunca coloque no frontend a `service_role`, a senha do banco ou a
`GEMINI_API_KEY`.

Para ativar o Web Push, siga `docs/WEB_PUSH_SETUP.md`. A chave VAPID privada
também deve permanecer apenas nos Secrets do Supabase.

## Desenvolvimento

```bash
python3 -m http.server 4173
npm test
```
