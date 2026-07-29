# DimDim V2 — documentação técnica

## Dados e autenticação

Cada instalação conecta uma URL de Apps Script e um token próprio. Todas as
leituras e gravações exigem esse token. A URL e o token ficam no `localStorage`
do navegador. O backend valida tamanho, tipos, ações e valores antes de escrever.

O token pode ser recuperado executando `mostrarTokenAcesso()` no editor do Apps
Script. Se houver suspeita de exposição, altere a propriedade
`DIMDIM_API_TOKEN` nas propriedades do script.

## Abas

- `Compras`
- `Categorias_Config`
- `Custos_Fixos_App`
- `Proventos_App`
- `Investimentos_App`

`configurarPlanilhaInicial()` cria apenas abas ausentes e não apaga dados.

## Endpoints

GET:

- `config`
- `categorias`
- `investimentos`
- `historico`
- `painel`
- `summary`

POST:

- `compra`
- `atualizarCompra`
- `excluirCompra`
- `salvarConfig`
- `categorias`
- `custosFixos`
- `proventos`
- `investimentos`
- `atualizarTaxaInvestimento`

## Privacidade da IA

Perguntas respondidas pelo modelo local ficam no aparelho. Quando o navegador não
suporta WebGPU ou a pergunta exige pesquisa atual, o aplicativo usa o Gemini e
envia o contexto financeiro necessário ao Apps Script. O backend encaminha a
requisição ao Gemini usando `GEMINI_API_KEY`, armazenada nas propriedades privadas
do script. A chave não é enviada ao navegador nem versionada no GitHub.

Como a chave anterior já esteve no histórico público do repositório, ela deve ser
desativada após a criação e configuração de uma nova chave.

## PWA

O cache inclui HTML, CSS, módulos JavaScript, manifesto, logos e ícones. Google
Sheets, Gemini, OCR e dependências externas precisam de rede quando não estiverem
disponíveis no cache do navegador.

## Checklist de validação

- Conexão sem token é recusada.
- Configuração é carregada antes da edição.
- Falha de gravação não limpa a lista.
- Histórico reaparece depois de recarregar.
- Exclusão remove a compra da planilha.
- Compras do mesmo mês em anos diferentes não são somadas.
- Compra noturna usa a data de São Paulo.
- Campos aceitam edição e exclusão.
- Interface abre após atualização do service worker.
