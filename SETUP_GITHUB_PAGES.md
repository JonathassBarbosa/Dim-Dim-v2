# Publicação do DimDim

## GitHub Pages

1. Abra **Settings → Pages** no repositório.
2. Selecione a branch `main` e a pasta raiz.
3. Salve e aguarde a publicação.

## Google Sheets e Apps Script

1. Crie ou abra a planilha que armazenará os dados.
2. Em **Extensões → Apps Script**, cole `apps-script/Code.gs`.
3. Execute `configurarPlanilhaInicial`.
4. No log da execução, copie o valor exibido depois de `TOKEN DIMDIM:`.
5. Abra **Configurações do projeto → Propriedades do script**.
6. Adicione `GEMINI_API_KEY` com uma chave nova do Gemini.
7. Crie uma implantação do tipo **App da Web**:
   - executar como: você;
   - acesso: qualquer pessoa.
8. Copie a URL terminada em `/exec`.
9. No DimDim, informe a URL e o token.

Se alterar o Apps Script, publique uma nova versão da implantação. Nunca publique
o token no GitHub, em capturas de tela ou mensagens públicas.
Também não coloque a chave do Gemini no frontend ou no repositório.

## Atualização do PWA

O service worker usa cache versionado. Após uma publicação, feche e abra o
aplicativo instalado. Se uma instalação muito antiga persistir, remova o atalho
da tela inicial e instale novamente.
