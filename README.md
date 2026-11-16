# Flowiq Studio

Editor mobile-first para criar interfaces 2D, organizar objetos, editar propriedades e testar interações.

## Estrutura

- `index.html`: shell semântico e pontos de montagem.
- `css/studio.css`: sistema visual responsivo único.
- `js/app.js`: coordenação da aplicação e navegação.
- `js/core/`: estado e histórico.
- `js/data/`: modelo de cena e persistência IndexedDB.
- `js/editor/`: renderização da hierarquia, palco e Inspector.
- `js/runtime/`: execução isolada da prévia e ações declarativas.
- `sw.js`: cache offline versionado.

## Desenvolvimento

Sirva a pasta por HTTP ou HTTPS:

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`.

## Atalhos

- `Ctrl/Cmd + S`: salvar.
- `Ctrl/Cmd + Z`: desfazer.
- `Ctrl/Cmd + Shift + Z` ou `Ctrl/Cmd + Y`: refazer.
- `Ctrl/Cmd + D`: duplicar objeto.
- `Delete` / `Backspace`: excluir objeto.

## Verificações

Execute os testes de modelo, histórico, runtime, estrutura do HTML e cache offline:

```bash
npm test
npm run check
```

## Armazenamento

Esta reconstrução usa um banco IndexedDB novo chamado `flowiq-studio-next`. Os dados da estrutura anterior não são migrados. Os projetos e arquivos permanecem no dispositivo. A exportação de backup reúne projetos e biblioteca em um único arquivo com verificação SHA-256.
