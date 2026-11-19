import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowScript } from '../js/runtime/flow-script.js';
import { Runtime } from '../js/runtime/runtime.js';
import { Scene } from '../js/data/model.js';

test('FlowScript parses safe event handlers and visual commands', () => {
  const program = parseFlowScript(`on("click", () => {
  show("Painel");
  setText("Titulo", "Bem-vindo!");
  setProperty("Fundo", "blur", 18);
  print("Abriu");
});`);
  assert.equal(program.event, 'click');
  assert.deepEqual(program.commands, [
    { type: 'show', target: 'Painel' },
    { type: 'setText', target: 'Titulo', value: 'Bem-vindo!' },
    { type: 'setProperty', target: 'Fundo', property: 'blur', value: 18 },
    { type: 'print', value: 'Abriu' }
  ]);
});

test('FlowScript rejects arbitrary JavaScript, unknown commands and unsafe properties', () => {
  assert.throws(() => parseFlowScript('alert(1);'), /use on/);
  assert.throws(() => parseFlowScript('on("click", () => {\n  fetch("https://example.com");\n});'), /comando não reconhecido/);
  assert.throws(() => parseFlowScript('on("click", () => {\n  setProperty("Painel", "__proto__", {});\n});'), /propriedade ou valor não permitido/);
  assert.throws(() => parseFlowScript('on("click", () => {\n  show("Painel");'), /Finalize/);
});

test('FlowScript safely opens a Frame and updates its child Blur in preview', () => {
  const scene = new Scene([
    { id: 'button', type: 'TextButton', name: 'Abrir', props: { text: 'Abrir' } },
    { id: 'panel', type: 'Frame', name: 'Painel', props: { visible: false }, children: [
      { id: 'blur', type: 'UIBackdrop', name: 'Desfoque', props: { blur: 8 } },
      { id: 'title', type: 'TextLabel', name: 'Titulo', props: { text: 'Antes' } }
    ] }
  ]);
  const logs = [];
  const runtime = new Runtime({ onLog: (message, type) => logs.push({ message, type }) });
  runtime.start({
    scripts: [{ nodeId: 'button', source: 'on("click", () => {\n  show("Painel");\n  setText("Titulo", "Olá!");\n  setProperty("Desfoque", "blur", 24);\n});' }]
  }, scene);
  runtime.dispatch(scene.get('button'), 'click');
  assert.equal(scene.get('panel').props.visible, true);
  assert.equal(scene.get('title').props.text, 'Olá!');
  assert.equal(scene.get('blur').props.blur, 24);
  assert.ok(logs.some(item => item.message.includes('3 ação(ões)')));
});

test('FlowScript reports missing and ambiguous object names instead of guessing', () => {
  const scene = new Scene([
    { id: 'button', type: 'TextButton', name: 'Abrir' },
    { id: 'a', type: 'Frame', name: 'Painel' },
    { id: 'b', type: 'Frame', name: 'Painel' }
  ]);
  const logs = [];
  const runtime = new Runtime({ onLog: message => logs.push(message) });
  runtime.start({ scripts: [{ nodeId: 'button', source: 'on("click", () => {\n  show("Painel");\n});' }] }, scene);
  runtime.dispatch(scene.get('button'), 'click');
  assert.ok(logs.some(message => message.includes('nome duplicado')));
  assert.equal(scene.get('a').props.visible, true);
  assert.equal(scene.get('b').props.visible, true);
});


test('FlowScript standalone Script listens to a named button without being attached to it', () => {
  const scene = new Scene([
    { id: 'button', type: 'TextButton', name: 'Abrir' },
    { id: 'script', type: 'Script', name: 'Controlador', props: { source: 'on("click", "Abrir", () => {\n  show("Painel");\n});' } },
    { id: 'panel', type: 'Frame', name: 'Painel', props: { visible: false } }
  ]);
  const program = parseFlowScript(scene.get('script').props.source);
  assert.equal(program.eventTarget, 'Abrir');
  const runtime = new Runtime();
  runtime.start({}, scene);
  runtime.dispatch(scene.get('button'), 'click');
  assert.equal(scene.get('panel').props.visible, true);
});
