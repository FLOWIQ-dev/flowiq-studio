import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('database migration adds an indexed version store without recreating projects or assets', async () => {
  const db = await read('js/data/database.js');
  assert.match(db, /const DB_VERSION = 2/);
  assert.match(db, /if \(!db\.objectStoreNames\.contains\(PROJECTS\)\)/);
  assert.match(db, /if \(!db\.objectStoreNames\.contains\(ASSETS\)\)/);
  assert.match(db, /if \(!db\.objectStoreNames\.contains\(VERSIONS\)\)/);
  assert.match(db, /versions\.createIndex\('projectId', 'projectId'/);
  assert.match(db, /const MAX_VERSIONS = 30/);
});

test('project writes and automatic checkpoints share one atomic IndexedDB transaction', async () => {
  const db = await read('js/data/database.js');
  const save = db.slice(db.indexOf('async saveProject('), db.indexOf('async createVersion('));
  assert.match(save, /db\.transaction\(\[PROJECTS, VERSIONS\], 'readwrite'\)/);
  assert.match(save, /projects\.get\(record\.id\)/);
  assert.match(save, /versions\.add\(/);
  assert.match(save, /projects\.put\(record\)/);
  assert.match(save, /tx\.oncomplete/);
  assert.match(save, /tx\.onabort/);
  assert.match(save, /AUTO_VERSION_INTERVAL/);
});

test('restoring a version preserves the current project before replacing it atomically', async () => {
  const db = await read('js/data/database.js');
  const restore = db.slice(db.indexOf('async restoreVersion('), db.indexOf('async deleteProject('));
  assert.match(restore, /db\.transaction\(\[PROJECTS, VERSIONS\], 'readwrite'\)/);
  assert.match(restore, /kind: 'pre-restore'/);
  assert.match(restore, /snapshot: current/);
  assert.match(restore, /new Scene\(restored\.scene\)/);
  assert.match(restore, /projects\.put\(restored\)/);
  assert.match(restore, /tx\.oncomplete/);
});

test('backup format carries history, validates integrity, and imports projects, assets and versions atomically', async () => {
  const db = await read('js/data/database.js');
  assert.match(db, /version: 2[\s\S]*versions/);
  assert.match(db, /\[1, 2\]\.includes\(data\.version\)/);
  assert.match(db, /checksum !== data\.integrity\.digest/);
  assert.match(db, /db\.transaction\(\[PROJECTS, ASSETS, VERSIONS\], 'readwrite'\)/);
  assert.match(db, /versions\.forEach\(item => v\.add\(item\)\)/);
  assert.match(db, /return \{ projects: projects\.length, assets: assets\.length, versions: versions\.length \}/);
});

test('app exposes version restore and requests persistent browser storage', async () => {
  const app = await read('js/app.js');
  const html = await read('index.html');
  assert.match(app, /this\.db\.requestPersistentStorage\(\)/);
  assert.match(app, /showProjectHistory\(project\.id\)/);
  assert.match(app, /this\.db\.createVersion\(project, \{ kind: 'manual'/);
  assert.match(app, /this\.db\.restoreVersion\(projectId, selected\)/);
  assert.match(app, /settings-storage/);
  assert.match(html, /id="settings-storage"/);
  assert.match(app, /this\.button\('Histórico', 'button subtle'\)/);
});

test('service worker and document use the same new cache build', async () => {
  const app = await read('index.html');
  const worker = await read('sw.js');
  assert.match(app, /2026\.11\.20\.165/);
  assert.match(worker, /flowiq-studio-clean-v165/);
  assert.match(worker, /2026\.11\.20\.165/);
});


test('opening a project with no selected instance keeps the inspector safe', async () => {
  const app = await read('js/app.js');
  const render = app.slice(app.indexOf('  renderInspectorPanel(node) {'), app.indexOf('  findAlignment(node'));
  assert.match(render, /node\?\.type === 'Frame'/);
  assert.match(render, /node\?\.type === 'UIBackdrop'/);
  assert.doesNotMatch(render, /relatedInstances: node\.type|parentInstance: node\.type/);
});


test('Script Explorer rows keep Abrir separate and expose move, rename, duplicate and delete actions', async () => {
  const view = await read('js/editor/view.js');
  const app = await read('js/app.js');
  const scriptRow = view.slice(view.indexOf("if (node.type === 'Script')"), view.indexOf("branch.append(row)"));
  assert.match(scriptRow, /treeOpenScript/);
  assert.match(scriptRow, /treeMenu/);
  assert.match(app, /node\.type === 'Script'[\s\S]*\['move', 'Mover'\][\s\S]*\['rename', 'Renomear'\][\s\S]*\['duplicate', 'Duplicar'\][\s\S]*\['delete', 'Excluir'\]/);
  assert.match(app, /if \(action === 'move'\) \{ this\.startTreeMoveMode\(id\); return; \}/);
  assert.match(app, /else if \(action === 'duplicate'\) this\.duplicateSelected\(\)/);
  assert.match(app, /else if \(action === 'delete'\) this\.deleteSelected\(\)/);
});

test('ScrollingFrame is a persisted scene class with Roblox-style elastic scrolling properties', async () => {
  const model = await read('js/data/model.js');
  const schema = await read('js/editor/property-schema.js');
  const view = await read('js/editor/view.js');
  const html = await read('index.html');
  assert.match(model, /'ScrollingFrame'/);
  assert.match(model, /elastic: true/);
  assert.match(schema, /registerPropertySchema\('ScrollingFrame'/);
  assert.match(schema, /checkbox\('elastic', 'Elastic'\)/);
  assert.match(view, /scene-scroll-viewport/);
  assert.match(view, /overscrollBehavior = elastic \? 'auto' : 'contain'/);
  assert.match(view, /webkitOverflowScrolling = 'touch'/);
  assert.match(html, /data-add-type="ScrollingFrame"/);
});
