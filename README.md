# DimDim — seu dinheiro, sem enrolação

PWA de finanças pessoais com lista de compras, OCR de nota fiscal, histórico real
no Google Sheets, painel 50-30-20 e assistente financeiro.

## Arquitetura

- `index.html`: estrutura da interface.
- `assets/app.css`: identidade visual e responsividade.
- `js/app.js`: fluxos e componentes da aplicação.
- `js/api.js`: cliente autenticado do Google Apps Script.
- `js/storage.js`: preferências locais.
- `js/dom.js`: sanitização e datas no horário de São Paulo.
- `js/config.js`: configuração do modelo de IA.
- `apps-script/Code.gs`: API protegida por token sobre o Google Sheets.
- `sw.js`: cache do núcleo instalável do PWA.

## Configuração segura

1. Crie uma planilha Google.
2. Abra **Extensões → Apps Script** e cole `apps-script/Code.gs`.
3. Execute `configurarPlanilhaInicial`.
4. Copie o token exibido no log de execução.
5. Implante como Web App:
   - executar como você;
   - acesso: qualquer pessoa.
6. Abra o DimDim e informe a URL `/exec` e o token.

O aplicativo não possui mais uma planilha pessoal configurada por padrão. O token
é armazenado apenas no navegador conectado e deve ser tratado como senha.

## Funcionalidades

- Lista persistente com edição e exclusão.
- Registro de compras com confirmação real do backend.
- Histórico carregado da planilha e exclusão de compra.
- OCR no navegador com revisão antes de salvar.
- Categorias, custos e proventos sincronizados antes da edição.
- Painel diário, mensal e anual, com filtro por mês **e ano**.
- Datas gravadas no fuso `America/Sao_Paulo`.
- Assistente local via WebLLM e alternativa Gemini.

## Limites do modo offline

O núcleo da interface abre offline depois da primeira visita. Recursos que dependem
de rede — planilha, Gemini e bibliotecas externas ainda não armazenadas — exigem
conexão. Nenhuma gravação é apresentada como concluída quando o backend falha.

## Atualização do backend anterior

Depois de substituir o `Code.gs`, gere uma nova versão da implantação do Apps
Script. Execute `configurarPlanilhaInicial` e conecte novamente o app usando o
token gerado. Os dados já existentes nas abas são preservados.

## Desenvolvimento

O projeto não exige build. Sirva a raiz por HTTP:

```bash
python3 -m http.server 4173
```

Abra `http://localhost:4173`.
