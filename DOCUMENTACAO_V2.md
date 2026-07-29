# DimDim v2 — documentação técnica

## Segurança

Cada registro financeiro possui `user_id`. Todas as tabelas têm RLS habilitado
e políticas que limitam leitura e escrita ao usuário autenticado. O bucket
`receipts` é privado e separa arquivos pelo UUID do usuário.

A chave pública do Supabase identifica o projeto, mas não ignora RLS. A
`service_role`, a senha do banco e a `GEMINI_API_KEY` nunca são enviadas ao
navegador.

## Dados

O esquema separa contas, cartões, faturas, transações, itens, parcelas,
recorrências, orçamentos, rendas, investimentos, lista e comprovantes.
`credit_card_invoices` controla competência, fechamento, vencimento e pagamento.
`user_settings` centraliza preferências sincronizadas.

Datas são gravadas em `timestamptz`; a interface apresenta
`America/Sao_Paulo`. Consultas mensais e anuais partem do ano corrente.

## Inteligência artificial

O frontend chama `supabase/functions/gemini`. A função exige JWT do usuário e
obtém `GEMINI_API_KEY` dos secrets do Supabase.

## Migração

Google Sheets e Apps Script não fazem parte da arquitetura atual. Antes de
desativar a planilha antiga, exporte os dados para posterior importação.

O PWA abre a interface offline após a primeira visita. Dados, autenticação,
sincronização e Gemini exigem conexão.
