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


test('Inspector property schemas are class-based and extensible', () => {
  assert.equal(PROPERTY_SCHEMA_VERSION, 10);
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
  assert.ok(!frameFields.some(field => /border/i.test(field.key)), 'Frame border properties are intentionally omitted');
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
  assert.match(view, /visit\(childId, children, layout\.width, layout\.height\)/);
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
  assert.ok(schema.includes('LiquidGlass'));
  assert.ok(schema.includes("{ value: 'Blur', label: 'Blur' }"));
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


test('UIBackdrop exposes only Blur and LiquidGlass with a safe parent-clipped renderer', async () => {
  const model = await readFile(new URL('../js/data/model.js', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../js/editor/property-schema.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  const effectBlock = schema.slice(schema.indexOf("registerPropertySchema('UIBackdrop'"));
  assert.equal((effectBlock.match(/\{ value: 'Blur', label: 'Blur' \}/g) || []).length, 1);
  assert.equal((effectBlock.match(/\{ value: 'LiquidGlass', label: 'LiquidGlass' \}/g) || []).length, 1);
  assert.doesNotMatch(effectBlock, /Acrylic/);
  assert.match(effectBlock, /slider\('blur', 'Blur', 0, 40, 0\.5\)/);
  assert.match(model, /effect: 'Blur', blur: 14/);
  assert.match(view, /item\.style\.backdropFilter = backdropVisible/);
  assert.match(view, /item\.style\.boxShadow = 'none'/);
  assert.match(view, /scene-glass-surface/);
  assert.match(view, /lensIntensity/);
  assert.doesNotMatch(view, /feDisplacementMap|feImage|createLensMapDataUrl|appendLensFilter/);
  assert.doesNotMatch(view, /0 5px 16px/);
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


test('Frame backdrop filtering is applied to the translucent Frame surface, not an isolated child layer', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /item\.style\.backdropFilter = backdropVisible/);
  assert.match(view, /item\.style\.backgroundColor = fillColor/);
  assert.match(view, /scene-glass-surface/);
  assert.doesNotMatch(view, /feDisplacementMap/);
  assert.doesNotMatch(view, /feTurbulence|fractalNoise/);
  assert.doesNotMatch(view, /el\('div', 'scene-backdrop-layer/);
});

test('ImageLabel reuses object URLs and DOM nodes across scene renders', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /container\._assetObjectUrls/);
  assert.match(view, /cached\.blob !== asset\.blob/);
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

test('LiquidGlass stays inside the parent shape and keeps the full blur range', async () => {
  const view = await readFile(new URL('../js/editor/view.js', import.meta.url), 'utf8');
  assert.match(view, /scene-glass-surface/);
  assert.match(view, /'blur\(' \+ blur \+ 'px\)'/);
  assert.doesNotMatch(view, /createLensMapDataUrl/);
  assert.match(view, /lensIntensity/);
  assert.match(view, /item\.style\.borderRadius = frameRadius \+ 'px'/);
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
  for (const type of ['Frame', 'TextButton', 'TextLabel', 'ImageLabel']) {
    const current = getPropertySchema(type);
    assert.equal(current.sections[0].title, 'Instance');
    assert.ok(current.sections.some(section => section.title === 'Layout'));
  }
});

test('ImageLabel does not clip its own selection handles', async () => {
  const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.scene-imagelabel{background-image:none!important;overflow:visible!important}'));
  assert.ok(css.includes('.scene-node.scene-imagelabel{overflow:visible!important;contain:none}'));
  assert.ok(css.includes('border-radius:inherit'));
});
