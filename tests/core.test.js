import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Scene, UDim2, resolveNodeLayout } from '../js/data/model.js';
import { History } from '../js/core/history.js';
import { Store } from '../js/core/store.js';
import { Runtime } from '../js/runtime/runtime.js';
import { getPropertySchema, registerPropertySchema, PROPERTY_SCHEMA_VERSION } from '../js/editor/property-schema.js';

test('scene creates valid nested objects and serializes without losing identity', () => {
  const scene = new Scene();
  const frame = scene.create('Frame');
  const button = scene.create('TextButton', frame.id);
  scene.create('TextLabel', frame.id);
  const restored = new Scene(scene.toJSON());
  assert.equal(restored.nodes.size, 3);
  assert.equal(restored.get(button.id).parentId, frame.id);
});

test('scene rejects cycles but allows any object as a parent', () => {
  const scene = new Scene();
  const frame = scene.create('Frame');
  const nested = scene.create('Frame', frame.id);
  const button = scene.create('TextButton', frame.id);
  assert.throws(() => scene.reparent(frame.id, nested.id), /ciclo/i);
  const textParent = scene.create('TextLabel', button.id);
  const imageChild = scene.create('ImageLabel', textParent.id);
  assert.equal(imageChild.parentId, textParent.id);
  const restored = new Scene(scene.toJSON());
  assert.equal(restored.get(imageChild.id).parentId, textParent.id);
});

test('legacy pixel layouts migrate to UDim2 without changing their geometry', () => {
  const scene = new Scene([{ id: 'legacy', type: 'Frame', name: 'Antigo', props: { x: 37, y: 52, width: 240, height: 130 } }]);
  const node = scene.get('legacy');
  assert.deepEqual(node.props.position, { x: { scale: 0, offset: 37 }, y: { scale: 0, offset: 52 } });
  assert.deepEqual(node.props.size, { x: { scale: 0, offset: 240 }, y: { scale: 0, offset: 130 } });
  assert.deepEqual(resolveNodeLayout(node, 960, 640), { x: 37, y: 52, width: 240, height: 130 });
});

test('UDim2 constructor follows the Roblox XScale, XOffset, YScale, YOffset order', () => {
  assert.deepEqual(UDim2(0, 0, 0.4, 0), {
    x: { scale: 0, offset: 0 },
    y: { scale: 0.4, offset: 0 }
  });
});

test('UDim2 resolves Scale, Offset and AnchorPoint against the parent', () => {
  const scene = new Scene([{ id: 'responsive', type: 'Frame', props: {
    position: { x: { scale: 0.5, offset: 10 }, y: { scale: 0.25, offset: 5 } },
    size: { x: { scale: 0.5, offset: 20 }, y: { scale: 0.25, offset: 10 } },
    anchorPoint: { x: 0.5, y: 0.5 }
  } }]);
  const node = scene.get('responsive');
  assert.deepEqual(resolveNodeLayout(node, 400, 300), { x: 100, y: 37.5, width: 220, height: 85 });
  const restored = new Scene(scene.toJSON()).get('responsive');
  assert.deepEqual(restored.props.position, node.props.position);
  assert.deepEqual(restored.props.size, node.props.size);
  assert.deepEqual(restored.props.anchorPoint, node.props.anchorPoint);
});

test('duplicate copies a complete subtree with new IDs', () => {
  const scene = new Scene();
  const frame = scene.create('Frame');
  scene.create('TextButton', frame.id);
  scene.create('TextLabel', frame.id);
  const copy = scene.duplicate(frame.id);
  assert.equal(copy.children.length, 2);
  assert.notEqual(copy.id, frame.id);
  assert.notEqual(copy.children[0], frame.children[0]);
  const sourceIds = new Set(scene.descendants(frame.id).map(node => node.id));
  assert.ok(scene.descendants(copy.id).every(node => !sourceIds.has(node.id)));
});

test('history restores snapshots in both directions', () => {
  const scene = new Scene();
  scene.create('Frame');
  const history = new History();
  const before = scene.snapshot();
  history.checkpoint({ scene: before, events: [] });
  scene.create('TextButton');
  const after = scene.snapshot();
  assert.equal(new Scene(history.undo({ scene: after, events: [] }).scene).nodes.size, 1);
  assert.equal(new Scene(history.redo({ scene: before, events: [] }).scene).nodes.size, 2);
});

test('store publishes immutable state updates', () => {
  const store = new Store({ screen: 'home' });
  let seen = '';
  store.subscribe(state => { seen = state.screen; });
  store.set({ screen: 'editor' });
  assert.equal(seen, 'editor');
  assert.equal(Object.isFrozen(store.state), true);
});

test('runtime executes only declared safe actions', () => {
  const scene = new Scene([{ id: 'button', type: 'TextButton', name: 'Botão', props: { text: 'Antes' } }]);
  const logs = [];
  const runtime = new Runtime({ onLog: message => logs.push(message) });
  runtime.start({ events: [{ nodeId: 'button', event: 'click', actions: [
    { type: 'setText', targetId: 'button', value: 'Depois' },
    { type: 'setProperty', targetId: 'button', property: 'opacity', value: 0.5 },
    { type: 'setProperty', targetId: 'button', property: '__proto__', value: 'blocked' },
    { type: 'toggleVisibility', targetId: 'button' },
    { type: 'log', value: 'Ação registrada' }
  ] }] }, scene);
  runtime.dispatch(scene.get('button'), 'click');
  assert.equal(scene.get('button').props.text, 'Depois');
  assert.equal(scene.get('button').props.opacity, 0.5);
  assert.equal(Object.hasOwn(scene.get('button').props, '__proto__'), false);
  assert.equal(scene.get('button').props.visible, false);
  assert.ok(logs.includes('Ação registrada'));
});

test('HTML DOM references and module imports resolve to real files', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const references = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(references.filter(id => !ids.has(id)))], []);
  const imports = [...app.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const path of imports) {
    const resolved = new URL(path, new URL('../js/app.js', import.meta.url));
    await readFile(resolved);
  }
});

test('stylesheet braces are balanced and only one layout sheet is loaded', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  const balance = [...css].reduce((sum, char) => sum + (char === '{' ? 1 : char === '}' ? -1 : 0), 0);
  assert.equal(balance, 0);
  assert.equal((html.match(/rel="stylesheet"/g) || []).length, 1);
});

test('service worker precaches every module used by the new application', async () => {
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const list = worker.match(/const FILES = \[([\s\S]*?)\];/)?.[1] || '';
  const files = [...list.matchAll(/'\.\/([^']+)'/g)].map(match => match[1].split('?')[0]).filter(Boolean);
  for (const path of files) await readFile(new URL('../' + path, import.meta.url));
});


test('Inspector property schemas are class-based and extensible', () => {
  assert.equal(PROPERTY_SCHEMA_VERSION, 1);
  const frame = getPropertySchema('Frame');
  assert.ok(frame.sections.some(section => section.title === 'Position · UDim2'));
  assert.ok(frame.sections.some(section => section.title === 'Size · UDim2'));
  registerPropertySchema('FutureWidget', { sections: [
    { title: 'Dados', fields: [{ key: 'value', label: 'Valor', type: 'number', min: 0, max: 10 }] }
  ]});
  assert.equal(getPropertySchema('FutureWidget').sections[0].fields[0].key, 'value');
  assert.throws(() => registerPropertySchema('FutureWidget', { sections: [] }), /Já existe/);
});
