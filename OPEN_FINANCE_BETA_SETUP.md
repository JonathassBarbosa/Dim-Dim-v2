# Open Finance Beta — configuração

Esta integração usa o Pluggy Connect. O usuário escolhe a instituição, lê os
termos e concede o consentimento no fluxo oficial. O DimDim não automatiza
cadastros em outros sites, não aceita termos pelo usuário e não recebe a senha
bancária.

## 1. Aplicar a migração

No Supabase Dashboard, abra **SQL Editor**, cole e execute:

`supabase/migrations/202607300001_open_finance_beta.sql`

A migração adiciona o perfil ampliado, consentimentos, conexões e tabelas de
dados importados. O CPF/CNPJ completo não é armazenado: somente SHA-256 e os
quatro últimos dígitos.

## 2. Criar a aplicação Pluggy

Crie uma aplicação de desenvolvimento no Dashboard da Pluggy e copie o Client
ID e Client Secret. O ambiente de desenvolvimento deve ser usado primeiro com
conectores Sandbox. Antes de usuários reais, solicite/habilite uma aplicação de
produção e confirme limites, preços e requisitos contratuais diretamente com a
Pluggy.

## 3. Cadastrar Secrets no Supabase

Em **Edge Functions > Secrets**, cadastre:

- `PLUGGY_CLIENT_ID`
- `PLUGGY_CLIENT_SECRET`
- `PLUGGY_WEBHOOK_SECRET`: gere com `openssl rand -hex 32`
- `PLUGGY_INCLUDE_SANDBOX`: use `true` durante testes e `false` em produção

Não coloque Client Secret ou Webhook Secret no GitHub, `index.html`,
`config.js` ou qualquer arquivo do frontend.

## 4. Implantar as Edge Functions

Implante:

- `pluggy-connect-token`
- `pluggy-register-item`
- `pluggy-revoke-item`
- `pluggy-webhook`

As três primeiras exigem JWT do usuário. O webhook não usa JWT porque é chamado
pela Pluggy; sua URL recebe um token secreto gerado no backend.

## 5. Configurar o aplicativo Pluggy

Cadastre esta URL de retorno OAuth:

`https://dimdim.smartservices.com.br/?pluggy=return`

O webhook por conexão é definido automaticamente quando o DimDim cria o Connect
Token. Se também configurar um webhook global no painel da Pluggy, evite
duplicá-lo sem necessidade.

## 6. Testar antes da produção

1. Ative temporariamente `PLUGGY_INCLUDE_SANDBOX=true`.
2. Entre no DimDim.
3. Abra **Mais > Open Finance Beta**.
4. Preencha o cadastro e marque individualmente os três consentimentos.
5. Clique em **Conectar uma instituição** e selecione um conector Sandbox.
6. Confirme no Supabase as tabelas `financial_connections`,
   `external_accounts`, `external_transactions` e
   `external_credit_card_bills`.
7. Pergunte ao assistente pelo saldo bancário, uso dos cartões e próximas
   faturas.
8. Teste **Revogar** e confirme que a conexão deixa de ser utilizada.
9. Desative Sandbox antes da publicação real.

## Limites desta fase

- A disponibilidade e a frequência de atualização dependem do conector e do
  plano Pluggy. Open Finance pode levar até 24 horas para refletir novas
  transações.
- O Meu Pluggy gratuito é um produto pessoal; ele não garante operação comercial
  multiusuário gratuita para o DimDim.
- DDA e captura automática de todos os boletos emitidos no CPF/CNPJ não fazem
  parte desta fase. Isso exige produto/provedor específico e avaliação jurídica.
- A integração é beta até a homologação em produção com a Pluggy.
