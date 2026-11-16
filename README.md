# Flowiq Studio

IDE 2D mobile-first, sem dependências de CDN. O Studio usa ES Modules, IndexedDB (com fallback local), importação/exportação `.flowiq` e pré-visualização Play.

## Executar

Sirva esta pasta por HTTP/HTTPS. Para desenvolvimento local, por exemplo:

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`. Em hospedagem estática, publique o conteúdo desta pasta na raiz do site (GitHub Pages funciona com ES Modules e Service Worker em HTTPS).

## Atalhos

- `Ctrl/Cmd + S`: salvar projeto.
- Explorer: selecionar instâncias e adicionar Frames/Botões.
- Inspector: editar posição, tamanho, cores, texto e visibilidade.
- Play: pré-visualizar sem alterar o documento de autoria.
- Importar/Exportar: transportar projetos em `.flowiq` (JSON).

Os projetos são armazenados localmente no navegador/dispositivo. Exporte backups para não depender de um único dispositivo.
