import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Scene, UDim2, resolveNodeLayout, COMPONENTS, normalizeZIndex } from '../js/data/model.js';
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

test('Frame SizeConstraint resolves both axes against the selected parent axis', () => {
  const relativeXX = new Scene([{ id: 'xx', type: 'Frame', props: {
    sizeConstraint: 'RelativeXX',
    size: { x: { scale: 0.5, offset: 0 }, y: { scale: 0.5, offset: 0 } }
  } }]).get('xx');
  assert.deepEqual(resolveNodeLayout(relativeXX, 400, 300), { x: 24, y: 24, width: 200, height: 200 });
  const relativeYY = new Scene([{ id: 'yy', type: 'Frame', props: {
    sizeConstraint: 'RelativeYY',
    size: { x: { scale: 0.5, offset: 0 }, y: { scale: 0.5, offset: 0 } }
  } }]).get('yy');
  assert.deepEqual(resolveNodeLayout(relativeYY, 400, 300), { x: 24, y: 24, width: 150, height: 150 });
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


test('ZIndex follows Roblox Sibling semantics with signed 32-bit integers', async () => {
  assert.equal(normalizeZIndex(1), 1);
  assert.equal(normalizeZIndex(0), 0);
  assert.equal(normalizeZIndex(-25), -25);
  assert.equal(normalizeZIndex(4.7), 5);
  assert.equal(normalizeZIndex(-4.7), -5);
  assert.equal(normalizeZIndex(9e20), 2147483647);
  assert.equal(normalizeZIndex(-9e20), -2147483648);
  const scene = new Scene([
    { id: 'parent', type: 'Frame', props: { zIndex: -50 }, children: [
      { id: 'low', type: 'TextLabel', props: { zIndex: -100 } },
      { id: 'high', type: 'ImageLabel', props: { zIndex: 100 } }
    ] },
    { id: 'button', type: 'TextButton', props: { zIndex: 0.2 } }
  ]);
  assert.equal(scene.get('parent').props.zIndex, -50);
  assert.equal(scene.get('low').props.zIndex, -100);
  assert.equal(scene.get('high').props.zIndex, 100);
  assert.equal(scene.get('button').props.zIndex, 0);
  const schema = ['Frame', 'TextButton', 'TextLabel', 'ImageLabel'].map(type =>
    getPropertySchema(type).sections.flatMap(section => section.fields).find(field => field.key === 'zIndex')
  );
  assert.ok(schema.every(field => field?.min === -2147483648 && field?.max === 2147483647));
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(app, /key === 'zIndex'\) node\.props\.zIndex = normalizeZIndex\(value\)/);
  assert.match(view, /item\.style\.zIndex = String\(normalizeZIndex\(p\.zIndex\)\)/);
  assert.match(view, /item\.querySelector\(':scope > \.scene-image-layer'\)/);
  assert.match(view, /child !== preservedImageLayer/);
  assert.match(view, /item\.insertBefore\(layer, childContainer\)/);
  assert.doesNotMatch(view, /childContainer\.prepend\(layer\)/);
  assert.match(css, /\.scene-node\{isolation:isolate\}/);
  assert.doesNotMatch(css, /\.scene-node\.scene-frame\{isolation:auto/);
  assert.ok(view.includes('orderedSiblingIds(scene, node.children)'));
});

test('Inspector property schemas are class-based and extensible', () => {
  assert.equal(PROPERTY_SCHEMA_VERSION, 22);
  const frame = getPropertySchema('Frame');
  assert.ok(frame.sections.some(section => section.title === 'Data'));
  const frameKeys = frame.sections.flatMap(section => section.fields.map(field => field.key));
  for (const key of ['sizeConstraint','zIndex','backgroundColor3','backgroundTransparency','opacity','visible','clipsDescendants']) {
    assert.ok(frameKeys.includes(key), 'Frame should expose ' + key);
  }
  const frameFields = frame.sections.flatMap(section => section.fields);
  for (const useful of ['automaticSize','layoutOrder','active','interactable','selectable','selectionOrder']) assert.ok(frameKeys.includes(useful), useful + ' should be available on Frame');
  assert.equal(frameFields.find(field => field.key === 'backgroundTransparency')?.type, 'slider');
  assert.equal(frameFields.find(field => field.key === 'rotation')?.type, 'slider');
  assert.equal(frameFields.find(field => field.key === 'opacity')?.type, 'slider');
  assert.equal(frameFields.find(field => field.key === 'backgroundTransparency')?.type, 'slider');
  assert.ok(frameFields.some(field => field.key === 'position' && field.type === 'udim2'));
  assert.ok(frameFields.some(field => field.key === 'size' && field.type === 'udim2'));
  assert.ok(frameFields.some(field => field.key === 'anchorPoint' && field.type === 'vector2'));
  assert.ok(!frameFields.some(field => /border|radius|corner/i.test(field.key)), 'Frame border and corner controls are intentionally omitted');
  registerPropertySchema('FutureWidget', { sections: [
    { title: 'Dados', fields: [{ key: 'value', label: 'Valor', type: 'number', min: 0, max: 10 }] }
  ]});
  assert.equal(getPropertySchema('FutureWidget').sections[0].fields[0].key, 'value');
  assert.throws(() => registerPropertySchema('FutureWidget', { sections: [] }), /Já existe/);
});


test('editor stage follows the available viewport and zoom is isolated to the scene world', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(app, /getStageSize\(\)/);
  assert.match(app, /host\?\.clientWidth/);
  assert.match(app, /this\.fitStage\(true\)/);
  assert.match(view, /const world = el\('div', 'scene-world'\)/);
  assert.match(view, /build\(id, world, rootWidth, rootHeight\)/);
});


test('preview keeps the editor stage logical size and scales the complete canvas to fit', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(app, /this\.previewStageSize = this\.getStageSize\(\)/);
  assert.match(app, /fitPreview\(\)/);
  assert.match(app, /sceneSize: this\.previewStageSize/);
  assert.match(view, /world\.style\.width = rootWidth \+ 'px'/);
  assert.match(view, /world\.style\.height = rootHeight \+ 'px'/);
});

test('double tap opens the Inspector and deleting from Inspector closes its panel', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /addEventListener\('dblclick'/);
  assert.match(app, /this\.setPanel\('inspector'\)/);
  assert.match(app, /onDelete: \(\) => \{ this\.deleteSelected\(\); this\.setPanel\('stage'\); \}/);
});

test('selection handles are visually compact and half transparent', async () => {
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(css, /width:8px;height:8px;min-width:8px;min-height:8px/);
  assert.match(css, /opacity:\.5/);
  assert.match(css, /width:22px;height:22px;min-width:22px;min-height:22px/);
});


test('Inspector actions live in the panel title bar and property groups are searchable and collapsible', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(html, /inspector-toolbar-actions/);
  assert.match(view, /makeAction\('Duplicar instância'/);
  assert.match(view, /makeAction\('Excluir instância'/);
  assert.match(view, /Filtrar propriedades/);
  assert.match(view, /aria-expanded/);
  assert.match(css, /inspector-panel-title\{display:grid;grid-template-columns:minmax\(0,1fr\) auto auto/);
});


test('editor recalculates nested descendants during live parent transforms', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(app, /updateSceneLayout\(\$\('scene'\), this\.scene, this\.getStageSize\(\)\)/);
  assert.match(view, /export function updateSceneLayout/);
  assert.ok(view.includes('visit(childId, canvas || children, childWidth, childHeight)'));
  const scene = new Scene([
    { id: 'parent', type: 'Frame', props: { size: { x: { scale: 0, offset: 400 }, y: { scale: 0, offset: 300 } } }, children: [
      { id: 'child', type: 'Frame', props: { position: { x: { scale: 0.5, offset: 0 }, y: { scale: 0.5, offset: 0 } }, size: { x: { scale: 0.5, offset: 0 }, y: { scale: 0.5, offset: 0 } } } }
    ] }
  ]);
  const parent = scene.get('parent');
  const child = scene.get('child');
  assert.deepEqual(resolveNodeLayout(child, 400, 300), { x: 200, y: 150, width: 200, height: 150 });
  parent.props.size.x.offset = 600;
  parent.props.size.y.offset = 500;
  assert.deepEqual(resolveNodeLayout(child, 600, 500), { x: 300, y: 250, width: 300, height: 250 });
});



test('camera tracking keeps drag coordinates stable while the camera moves', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /pointerBasisX: this\.screenDeltaToParent\(target, 1, 0\)/);
  assert.match(app, /pointerBasisY: this\.screenDeltaToParent\(target, 0, 1\)/);
  assert.match(app, /const dx = drag\.pointerBasisX\.x \* screenDx/);
  assert.match(app, /is-camera-interacting/);
});

test('camera tracking respects stage bounds and exposes a reset action after overflow', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(app, /this\.cameraEscaped = Math\.abs\(this\.cameraOffset\.x\) > stageWidth \* 0\.3/);
  assert.match(app, /if \(!this\.drag\)/);
  assert.match(app, /resetCamera\(\)/);
  assert.match(app, /this\.cameraEscaped = Math\.abs\(this\.cameraOffset\.x\)/);
  assert.match(html, /id="camera-reset"/);
  assert.match(css, /camera-reset-button/);
});
test('Explorer camera tracking is independent from Inspector and preserves the final framing', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.ok(app.includes('this.cameraTracking = false'));
  assert.ok(app.includes("['track-camera', trackingLabel]"));
  assert.ok(app.includes("if (action === 'track-camera')"));
  assert.ok(app.includes("this.cameraTrackingId = stop ? null : id"));
  assert.ok(app.includes('const temporary = !this.cameraTracking && this.store.state.panel === \'inspector\''));
  assert.ok(app.includes('this.inspectorCameraSnapshot = { offset: { ...this.cameraOffset }, zoom: this.zoom }'));
  assert.ok(app.includes('this.cameraOffset = { ...this.inspectorCameraSnapshot.offset }'));
  assert.ok(app.includes('this.inspectorCameraSnapshot = null'));
  assert.ok(app.includes('if (this.cameraTracking && this.cameraTrackingId === current.id) this.trackSelectedObject()'));
  assert.ok(app.includes("this.cameraTracking ? 'Câmera acompanhando ' + node.name"));
  assert.ok(view.includes("translate3d(' + offsetX + 'px,' + offsetY + 'px,0) scale('"));
  assert.ok(css.includes('#screen-editor .stage-viewport{'));
  assert.ok(css.includes('transition:none!important'));
  const closePanel = app.slice(app.indexOf('  setPanel(name)'), app.indexOf('  toggleAddMenu()'));
  assert.ok(closePanel.includes("this.cameraTracking"));
  assert.ok(closePanel.includes('this.cameraOffset = { ...this.inspectorCameraSnapshot.offset }'));
  assert.ok(!closePanel.includes("this.cameraTracking = false"));
  const reset = app.slice(app.indexOf('  fitStage(resetZoom'), app.indexOf('  setPanel(name)'));
  assert.ok(reset.includes('cameraOffset = { x: 0, y: 0 }'));
});


test('camera tracking keeps the stage fixed and freezes zoom during object transforms', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  const tracking = app.slice(app.indexOf('  trackSelectedObject()'), app.indexOf('  fitStage(resetZoom'));
  assert.match(tracking, /if \(!this\.drag\)/);
  assert.match(tracking, /this\.cameraOffset = \{ x: this\.cameraOffset\.x \+ dx, y: this\.cameraOffset\.y \+ dy \}/);
  assert.doesNotMatch(tracking, /stage\.style\.(?:width|height|transform)/);
  assert.match(css, /stage-viewport\{[\s\S]*?overflow:hidden/);
  assert.match(css, /#screen-editor #scene\{[\s\S]*?overflow:hidden;contain:layout paint/);
  assert.match(css, /scene-world\{[\s\S]*?transition:none!important/);
});


test('Frame opacity composites the whole subtree while background transparency stays local', async () => {
  const model = await readFile(new URL('../js/data/model.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(model, /Frame: .*opacity: 1/);
  assert.match(view, /item\.style\.opacity = String\(Math\.max\(0, Math\.min\(1, Number\(p\.opacity \?\? 1\)\)\)\)/);
  assert.match(view, /const alpha = 1 - Math\.max\(0, Math\.min\(1, Number\(p\.backgroundTransparency\) \|\| 0\)\)/);
  assert.match(app, /key === 'opacity' \|\| key === 'backgroundTransparency'/);
});

test('Frame Position and Size use editable four-value UDim2 tuples', async () => {
  const schema = await readFile(new URL('../js/editor/property-schema.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(schema, /udim2\('position', 'Position'/);
  assert.match(schema, /udim2\('size', 'Size'/);
  assert.match(view, /0, 30, 0, 20/);
  assert.match(view, /const expected = type === 'udim2' \? 4 : 2/);
  assert.match(app, /\['position', 'size'\]\.includes\(key\)/);
});


test('Frame AnchorPoint uses a compact editable two-value tuple and sliders have editable numeric fields', async () => {
  const schema = await readFile(new URL('../js/editor/property-schema.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(schema, /vector2\('anchorPoint', 'AnchorPoint'/);
  assert.match(view, /type === 'udim2' \|\| type === 'vector2'/);
  assert.match(view, /valueInput\.type = 'number'/);
  assert.match(view, /valueInput\.addEventListener\('input'/);
  assert.match(app, /key === 'anchorPoint' && value && typeof value === 'object'/);
  assert.match(view, /type !== 'udim2' && type !== 'vector2'/);
});


test('UIBackdrop is a child pseudo-instance with effect settings and renders through the Frame surface', async () => {
  const model = await readFile(new URL('../js/data/model.js', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../js/editor/property-schema.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(model.includes("'UIBackdrop'"));
  assert.ok(model.includes("UIBackdrop: { x: 0, y: 0, width: 1, height: 1"));
  assert.ok(model.includes("enabled: true, effect: 'Blur'"));
  assert.ok(schema.includes("registerPropertySchema('UIBackdrop'"));
  assert.ok(schema.includes("slider('blur', 'Blur amount'"));
  assert.ok(!schema.includes("value: 'Prism'"));
  assert.ok(!schema.includes("value: 'Emboss'"));
  assert.ok(!schema.includes("value: 'Holographic'"));
  assert.ok(!schema.includes("value: 'FrostedGlass'"));
  assert.ok(!schema.includes("value: 'Acrylic'"));
  assert.ok(view.includes("child?.type === 'UIBackdrop'"));
  assert.ok(view.includes('backdropVisible'));
  assert.ok(view.includes('item.style.backdropFilter'));
  assert.ok(view.includes('item.style.webkitBackdropFilter'));
  assert.ok(view.includes('item.style.backgroundColor = fillColor'));
  assert.ok(app.includes("type === 'UIBackdrop'"));
  assert.ok(html.includes('data-add-type="UIBackdrop"'));
});


test('UIBackdrop is a single powerful Blur material with clipped parent rendering', async () => {
  const model = await readFile(new URL('../js/data/model.js', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../js/editor/property-schema.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const effectBlock = schema.slice(schema.indexOf("registerPropertySchema('UIBackdrop'"));
  assert.match(effectBlock, /slider\('blur', 'Blur amount', 0, 64, 0\.5\)/);
  for (const key of ['saturation', 'brightness', 'contrast', 'tintColor', 'tintOpacity']) assert.ok(effectBlock.includes(key));
  assert.doesNotMatch(effectBlock, /Prism|Emboss|Holographic|LiquidGlass|Acrylic/);
  assert.match(model, /effect: 'Blur', blur: 22/);
  assert.match(view, /item\.style\.backdropFilter = backdropVisible \? filter : 'none'/);
  assert.match(view, /brightness\(' \+ brightness \+ '\) contrast\('/);
  assert.doesNotMatch(view, /scene-effect-surface|scene-effect-prism|scene-effect-emboss|scene-effect-holographic/);
  assert.doesNotMatch(schema, /CornerRadius|Arredondamento/);
});

test('UIBackdrop can only exist once as a leaf child of a Frame', () => {
  const scene = new Scene();
  const frame = scene.create('Frame');
  const modifier = scene.create('UIBackdrop', frame.id);
  assert.equal(modifier.parentId, frame.id);
  assert.throws(() => scene.create('UIBackdrop'), /filho de um Frame/);
  assert.throws(() => scene.create('UIBackdrop', modifier.id), /não aceita objetos filhos/);
  assert.throws(() => scene.create('UIBackdrop', frame.id), /já possui um UIBackdrop/);
  const label = scene.create('TextLabel');
  assert.throws(() => scene.reparent(modifier.id, label.id), /filho de um Frame/);
});


test('Blur is clipped to the Frame surface', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(view, /item\.style\.backgroundColor = fillColor/);
  assert.match(view, /item\.style\.backdropFilter = backdropVisible/);
    assert.match(view, /item\.style\.webkitBackdropFilter = item\.style\.backdropFilter/);
  assert.match(css, /Blur is rendered directly on its owning Frame/);
  assert.doesNotMatch(view, /scene-effect-surface|scene-effect-prism|scene-effect-emboss|scene-effect-holographic|feDisplacementMap|feTurbulence|fractalNoise/);
});

test('ImageLabel reuses object URLs and DOM nodes across scene renders', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /container\._assetObjectUrls/);
  assert.match(view, /cached\.blob !== initialAsset\.blob/);
  assert.match(view, /existingNodes\.get\(node\.id\)/);
  assert.match(view, /existing && existing\.tagName/);
  assert.doesNotMatch(view, /for \(const url of container\._objectUrls/);
});


test('ImageLabel renders a persistent real image element instead of a CSS background', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(view, /el\('img', 'scene-image-content'\)/);
  assert.match(view, /image\.src = cached\.url/);
  assert.match(view, /preservedImage/);
  assert.match(css, /\.scene-image-content/);
});

test('Opening the mobile Inspector does not dim the editable stage', async () => {
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(css, /editor-shell\[data-panel="inspector"\]::before\{opacity:0;pointer-events:none\}/);
});

test('Legacy LiquidGlass project materials are normalized to Blur', () => {
  const scene = new Scene([{ type: 'Frame', children: [{ type: 'UIBackdrop', props: { effect: 'LiquidGlass' } }] }]);
  const frame = scene.get(scene.roots[0]);
  const material = scene.get(frame.children[0]);
  assert.equal(material.props.effect, 'Blur');
});

test('Frame and ImageLabel share the exact same UDim2 and AnchorPoint layout controls', () => {
  const frame = getPropertySchema('Frame');
  const image = getPropertySchema('ImageLabel');
  const layoutOf = current => current.sections.find(section => section.title === 'Layout');
  const fields = current => layoutOf(current).fields.map(({ key, type, subgroup, components }) => ({ key, type, subgroup, components }));
  assert.deepEqual(fields(frame), fields(image));
  assert.deepEqual(fields(frame), [
    { key: 'position', type: 'udim2', subgroup: 'Position', components: 4 },
    { key: 'size', type: 'udim2', subgroup: 'Size', components: 4 },
    { key: 'anchorPoint', type: 'vector2', subgroup: 'AnchorPoint', components: 2 }
  ]);
  for (const type of ['Frame', 'TextButton', 'ImageButton', 'TextLabel', 'ImageLabel']) {
    const current = getPropertySchema(type);
    assert.equal(current.sections[0].title, 'Appearance');
    assert.ok(current.sections.some(section => section.title === 'Layout'));
  }
});

test('ImageLabel does not clip its own selection handles', async () => {
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.scene-imagelabel{background-image:none!important;overflow:visible!important}'));
  assert.ok(css.includes('.scene-node.scene-imagelabel{overflow:visible!important;contain:none}'));
  assert.ok(css.includes('border-radius:inherit'));
});


test('ImageLabel exposes a Frame-like background and practical image controls', async () => {
  const schema = getPropertySchema('ImageLabel');
  const image = schema.sections.find(section => section.title === 'Image').fields;
  const appearance = schema.sections.find(section => section.title === 'Appearance').fields;
  assert.ok(image.some(field => field.key === 'assetId' && field.type === 'asset'));
  assert.deepEqual(image.find(field => field.key === 'fit').values.map(item => item.value), ['fill','contain','cover','tile']);
  assert.ok(image.some(field => field.key === 'imageTransparency'));
  assert.ok(appearance.some(field => field.key === 'backgroundColor3'));
  assert.ok(appearance.some(field => field.key === 'backgroundTransparency'));
});

test('Asset rename preserves the existing blob record', async () => {
  const database = await readFile(new URL('../js/data/database.js', import.meta.url), 'utf8');
  assert.match(database, /async renameAsset\(id, name\)/);
  assert.match(database, /store\.put\(\{ \.\.\.request\.result, name:/);
});

test('Image picker is visual and asset library supports rename and thumbnails', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(app, /openImagePicker\(/);
  assert.match(app, /data-choose-asset/);
  assert.match(app, /data-rename-asset/);
  assert.match(app, /asset-preview/);
  assert.match(html, /image-picker-grid/);
});


test('ImageLabel follows Roblox-style property groups and exposes ImageColor3', () => {
  const schema = getPropertySchema('ImageLabel');
  assert.equal(schema.sections[0].title, 'Appearance');
  const image = schema.sections.find(section => section.title === 'Image');
  assert.ok(image.fields.some(field => field.key === 'imageColor3' && field.type === 'color'));
  assert.ok(image.fields.some(field => field.key === 'imageTransparency'));
  assert.equal(schema.sections.findIndex(section => section.title === 'Appearance'), 0);
});

test('ImageLabel renderer applies image tint without changing the background', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /scene-image-tint/);
  assert.match(view, /p\.imageColor3/);
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(css, /mix-blend-mode:multiply/);
});


test('ImageLabel composites tint and image transparency in one isolated image layer', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(view, /scene-image-layer/);
  assert.match(view, /layer\.style\.opacity = String\(imageAlpha\)/);
  assert.match(view, /layer\.append\(image, tint\)/);
  assert.match(view, /layer\.style\.backgroundImage = 'url\("/);
  assert.match(css, /scene-image-layer\{isolation:isolate\}/);
  assert.match(css, /scene-image-layer>\.scene-image-tint[\s\S]*?mix-blend-mode:multiply/);
});


test('ZIndex is available on every GuiObject and supports Roblox signed integer layers', () => {
  const scene = new Scene();
  for (const type of ['Frame', 'TextButton', 'TextLabel', 'ImageLabel']) {
    const node = scene.create(type);
    assert.equal(node.props.zIndex, 1, type + ' should default to ZIndex 1');
    const fields = getPropertySchema(type).sections.flatMap(section => section.fields);
    assert.equal(fields.find(field => field.key === 'zIndex')?.min, -2147483648, type + ' should expose negative ZIndex');
    assert.equal(fields.find(field => field.key === 'zIndex')?.max, 2147483647, type + ' should expose positive ZIndex');
  }
  assert.ok(COMPONENTS.some(component => component.type === 'TextLabel'), 'TextLabel must be available in Insert Object');
  assert.ok(COMPONENTS.some(component => component.type === 'ImageButton'), 'ImageButton must be available in Insert Object');
});

test('TextLabel typography is focused: useful fonts and independent weights, no text stroke or legacy controls', async () => {
  const fields = getPropertySchema('TextLabel').sections.flatMap(section => section.fields);
  const font = fields.find(field => field.key === 'fontFace');
  const weight = fields.find(field => field.key === 'fontWeight');
  assert.deepEqual(font.values.map(item => item.value), ['Arial', 'Inter', 'Roboto', 'Georgia', 'Monospace']);
  assert.deepEqual(weight.values.map(item => item.value), ['400', '500', '600', '700']);
  for (const removed of ['textStrokeColor3', 'textStrokeTransparency', 'openTypeFeatures', 'maxVisibleGraphemes', 'textTruncate', 'textDirection']) {
    assert.ok(!fields.some(field => field.key === removed), removed + ' should not appear in TextLabel properties');
  }
  const scene = new Scene();
  const label = scene.create('TextLabel');
  assert.equal(label.props.fontFace, 'Arial');
  assert.equal(label.props.fontWeight, '400');
  assert.ok(!('textStrokeColor3' in label.props));
  assert.ok(!('textStrokeTransparency' in label.props));
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /weight = \[400, 500, 600, 700\]/);
  assert.match(view, /content\.style\.fontWeight = String\(weight\)/);
  assert.doesNotMatch(view, /webkitTextStroke|textStrokeTransparency|FONT_WEIGHT/);
});

test('TextLabel exposes Roblox text properties and hierarchy-aware rendering', async () => {
  const schema = getPropertySchema('TextLabel');
  const fields = schema.sections.flatMap(section => section.fields);
  for (const key of ['text','textColor3','textTransparency','fontFace','fontWeight','textSize','textScaled','textWrapped','textXAlignment','textYAlignment','richText','lineHeight','zIndex']) {
    assert.ok(fields.some(field => field.key === key), 'TextLabel should expose ' + key);
  }
  assert.equal(fields.find(field => field.key === 'text')?.type, 'textarea');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(view, /item\.style\.zIndex = String\(normalizeZIndex\(p\.zIndex\)\)/);
  assert.match(view, /childContainer\.style\.zIndex = '2'/);
  assert.match(view, /fitTextSize\(/);
  assert.match(view, /richTextFragment\(/);
  assert.match(css, /scene-node\{isolation:isolate\}/);
});


test('Blur has no optional glass border property or rim rendering', async () => {
  const scene = new Scene();
  const frame = scene.create('Frame');
  const material = scene.create('UIBackdrop', frame.id);
  assert.equal(Object.hasOwn(material.props, 'glassBorder'), false);
  const fields = getPropertySchema('UIBackdrop').sections.flatMap(section => section.fields);
  assert.ok(!fields.some(field => field.key === 'glassBorder'));
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /glassBorder|inset 0 0 0 1px/);
});

test('TextButton and ImageButton are complete GuiButton instances with Roblox-style properties', async () => {
  const scene = new Scene();
  const textButton = scene.create('TextButton');
  const imageButton = scene.create('ImageButton');
  assert.equal(textButton.props.text, 'Botão');
  assert.equal(textButton.props.autoButtonColor, true);
  assert.equal(imageButton.props.assetId, '');
  assert.equal(imageButton.props.hoverAssetId, '');
  assert.equal(imageButton.props.pressedAssetId, '');
  assert.equal(imageButton.props.autoButtonColor, true);
  const textFields = getPropertySchema('TextButton').sections.flatMap(section => section.fields);
  for (const key of ['text','textColor3','textTransparency','textSize','textScaled','textWrapped','textXAlignment','textYAlignment','fontFace','autoButtonColor']) assert.ok(textFields.some(field => field.key === key), key);
  const imageFields = getPropertySchema('ImageButton').sections.flatMap(section => section.fields);
  for (const key of ['assetId','hoverAssetId','pressedAssetId','imageColor3','imageTransparency','fit','autoButtonColor']) assert.ok(imageFields.some(field => field.key === key), key);
  assert.ok(COMPONENTS.some(item => item.type === 'ImageButton'));
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(view, /node\.type === 'TextButton' \|\| node\.type === 'ImageButton'/);
  assert.match(view, /p\.hoverAssetId/);
  assert.match(view, /p\.pressedAssetId/);
  assert.match(view, /onRun\(node, 'click'\)/);
  assert.match(html, /data-add-type="ImageButton"/);
});


test('Text and image GUI classes share one square Roblox-style visual and inspector schema', async () => {
  const scene = new Scene();
  for (const type of ['TextButton', 'ImageButton', 'TextLabel', 'ImageLabel']) {
    const node = scene.create(type);
    assert.equal(node.props.radius, 0, type + ' must have square corners');
    const fields = getPropertySchema(type).sections.flatMap(section => section.fields);
    for (const key of ['backgroundColor3', 'backgroundTransparency', 'borderColor3', 'borderSizePixel', 'opacity', 'rotation', 'visible', 'position', 'size', 'anchorPoint']) {
      assert.ok(fields.some(field => field.key === key), type + ' should share ' + key);
    }
  }
  const textButton = getPropertySchema('TextButton').sections.find(section => section.title === 'Text').fields;
  const textLabel = getPropertySchema('TextLabel').sections.find(section => section.title === 'Text').fields;
  assert.deepEqual(textButton, textLabel, 'TextButton and TextLabel must use the same text controls');
  const imageButton = getPropertySchema('ImageButton').sections.find(section => section.title === 'Image').fields.filter(field => !['hoverAssetId', 'pressedAssetId'].includes(field.key));
  const imageLabel = getPropertySchema('ImageLabel').sections.find(section => section.title === 'Image').fields;
  assert.deepEqual(imageButton, imageLabel, 'ImageButton and ImageLabel must share image controls');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(view, /export function renderInspector\(container, node/);
  assert.equal((html.match(/id="inspector"/g) || []).length, 1, 'the editor must have exactly one dynamic Inspector host');
  assert.match(view, /\['TextButton', 'ImageButton', 'TextLabel', 'ImageLabel'\]\.includes\(node\.type\) \? '0'/);
});


test('scene renderer keeps a stable child container for every instance', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /const childContainer = existingChildContainer \|\| el\('div', 'scene-children'\)/);
  assert.match(view, /item\.append\(childContainer\)/);
  assert.ok(view.includes('orderedSiblingIds(scene, node.children)'));
});


test('mobile panels are hidden unless selected, including after Inspector grid layout', async () => {
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(css, /\.editor-shell:not\(\[data-panel="explorer"\]\) \.explorer-panel\{display:none!important/);
  assert.match(css, /\.editor-shell:not\(\[data-panel="inspector"\]\) \.inspector-panel\{display:none!important/);
  assert.match(css, /\.editor-shell\[data-panel="explorer"\] \.explorer-panel\{display:grid!important/);
  assert.match(css, /\.editor-shell\[data-panel="inspector"\] \.inspector-panel\{display:grid!important/);
});

test('scene renderer retains a stable child container for every instance', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /const childContainer = existingChildContainer \|\| el\('div', 'scene-children'\)/);
  assert.match(view, /item\.append\(childContainer\)/);
  assert.ok(view.includes('orderedSiblingIds(scene, node.children)'));
});


test('Script is an independent non-visual scene instance', () => {
  const scene = new Scene();
  const script = scene.create('Script', null, 'AbrirPainel');
  script.props.source = 'on("click", "Abrir", () => {\n  show("Painel");\n});';
  assert.equal(script.type, 'Script');
  const restored = new Scene(scene.toJSON());
  assert.equal(restored.get(script.id).props.source, script.props.source);
  assert.ok(COMPONENTS.some(item => item.type === 'Script'));
});


test('new equal-ZIndex siblings are painted above older siblings and Inspector exposes component navigation', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(view, /normalizeZIndex\(a\.node\.props\.zIndex\) - normalizeZIndex\(b\.node\.props\.zIndex\) \|\| a\.index - b\.index/);
  assert.match(view, /dataset\.treeOpenScript = id/);
  assert.match(view, /inspector-instance-bar/);
  assert.match(app, /data-tree-open-script/);
  assert.equal((html.match(/data-add-type="Script"/g) || []).length, 1);
});



test('ScrollingFrame descendants use canvas coordinates for layout and live editing', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(view.includes('visit(childId, canvas || children, childWidth, childHeight)'));
  assert.ok(view.includes('childSpace.width, childSpace.height'));
  assert.ok(app.includes("parent.type !== 'ScrollingFrame'"));
  assert.ok(app.includes("automaticCanvasSize === 'Y'"));
});

test('ScrollingFrame remains scrollable in the editor while preserving its canvas during edits', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(view.includes("p.scrollingEnabled !== false ? 'auto' : 'hidden'"));
  assert.ok(view.includes('childContainer.scrollLeft = previousScrollLeft'));
  assert.ok(view.includes("canvas.style.height = childHeight + 'px'"));
  assert.ok(app.includes('scrollViewport && target === scrollViewport.parentElement'));
});

test('preview GuiObjects allow touch gestures to reach nested ScrollingFrame viewports', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.ok(view.includes("item.style.touchAction = preview ? 'auto' : (isScrollingFrame || insideScrollViewport ? 'pan-x pan-y' : 'none')"));
  assert.ok(view.includes("childContainer.style.touchAction = enabled ?"));
  assert.ok(css.includes('.preview-screen .scene-node{touch-action:auto}'));
  assert.ok(css.includes('.scene-scroll-viewport'));
});

test('ScrollingFrame separates editing from native momentum scrolling', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.ok(view.includes("function setupElasticScroll(viewport, enabled, direction)"));
  assert.ok(view.includes("viewport.style.overscrollBehavior = 'auto'"));
  assert.ok(view.includes("viewport.style.webkitOverflowScrolling = 'touch'"));
  assert.ok(view.includes("viewport.dataset.editorMode = 'edit'"));
  assert.ok(view.includes("childContainer.dataset.editorMode === 'scroll'"));
  assert.ok(view.includes("modeButton.dataset.scrollMode = 'true'"));
  assert.ok(view.includes("modeButton.title = scrollMode ? 'Editar conteúdo' : 'Rolar conteúdo'"));
  assert.ok(view.includes("insideScrollViewport && parent.closest('.scene-scroll-viewport')?.dataset.editorMode === 'scroll'"));
  assert.ok(view.includes("viewport.addEventListener('wheel', wheelGuard, { passive: false })"));
  assert.ok(!view.includes("touchmove', move, { passive: false"));
  assert.ok(!view.includes("const stiffness ="));
  assert.ok(app.includes("viewport.dataset.editorMode = scrolling ? 'scroll' : 'edit'"));
  assert.ok(app.includes("scrollViewport.dataset.editorMode === 'scroll' && isTouchGesture"));
  assert.ok(app.includes("viewport.querySelectorAll('.scene-node').forEach(child =>"));
  assert.ok(css.includes(".scene-scroll-viewport{overscroll-behavior:auto!important"));
  assert.ok(css.includes("-webkit-overflow-scrolling:touch"));
  assert.ok(css.includes(".scene-node>.scroll-mode-handle"));
});

test('opening a project renders ScrollingFrame without an out-of-scope enabled variable', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const classToggle = view.indexOf("childContainer.classList.toggle('scene-scroll-viewport', isScrollingFrame)");
  const enabledDeclaration = view.indexOf("const enabled = isScrollingFrame && p.scrollingEnabled !== false", classToggle);
  const scrollingBlock = view.indexOf("if (isScrollingFrame) {", classToggle);
  const elasticCall = view.indexOf("setupElasticScroll(childContainer, enabled && p.elastic !== false, direction, p.rotation)", scrollingBlock);
  assert.ok(enabledDeclaration > classToggle && enabledDeclaration < scrollingBlock);
  assert.ok(elasticCall > scrollingBlock);
  assert.ok(!view.includes("const enabled = p.scrollingEnabled !== false"));
  assert.ok(!view.includes("const direction = ['X', 'Y', 'XY'].includes(p.scrollingDirection) ? p.scrollingDirection : 'XY';\n      let canvasWidth"));
});

test('ScrollingFrame editor separates touch scrolling from moving the selected frame', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.ok(view.includes("isScrollingFrame || insideScrollViewport ? 'pan-x pan-y' : 'none'"));
  assert.ok(view.includes("move.dataset.move = 'true'"));
  assert.match(view, /move\.innerHTML = '<svg viewBox="0 0 24 24"/);
  assert.match(css, /\.scene-node>\.move-handle svg/);
  assert.ok(app.includes("const isTouchGesture = event.pointerType === 'touch' || event.pointerType === 'pen'"));
  assert.ok(app.includes('if (scrollViewport && isTouchGesture && !moveHandle && !resizeHandle && !rotateHandle)'));
  assert.ok(app.includes("const moveHandle = event.target.closest('[data-move]')"));
  assert.ok(css.includes('.scene-node>.move-handle'));
  assert.ok(css.includes('overscroll-behavior:contain'));
  assert.ok(css.includes('width:32px;min-width:32px;height:32px;min-height:32px'));
  assert.ok(view.includes("p.elastic !== false, direction"));
});
