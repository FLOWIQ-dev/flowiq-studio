const ID = () => globalThis.crypto?.randomUUID?.() || 'node_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
const TYPES = new Set(['Frame', 'TextButton', 'TextLabel', 'ImageLabel']);
const DEFAULTS = Object.freeze({
  Frame: { x: 24, y: 24, width: 320, height: 220, background: '#1b2940', radius: 14, opacity: 1, visible: true, border: '#334155', borderWidth: 0 },
  TextButton: { x: 24, y: 24, width: 160, height: 48, background: '#2563eb', color: '#ffffff', radius: 10, fontSize: 15, text: 'Botão', opacity: 1, visible: true, border: '#334155', borderWidth: 0 },
  TextLabel: { x: 24, y: 24, width: 220, height: 42, background: '#121e2e', color: '#f8fafc', radius: 0, fontSize: 16, text: 'Texto', opacity: 1, visible: true, border: '#334155', borderWidth: 0 },
  ImageLabel: { x: 24, y: 24, width: 140, height: 120, background: '#24344c', color: '#ffffff', radius: 10, opacity: 1, visible: true, border: '#334155', borderWidth: 0, assetId: '', fit: 'cover' }
});
const cleanName = (value, fallback) => String(value ?? '').trim().slice(0, 64) || fallback;
const cleanProps = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item))) out[key] = item;
  }
  return out;
};

export class SceneNode {
  constructor(type, name, props = {}, id = ID()) {
    if (!TYPES.has(type)) throw new Error('Tipo de objeto não reconhecido.');
    this.id = id;
    this.type = type;
    this.name = cleanName(name, type);
    this.props = { rotation: 0, ...DEFAULTS[type], ...cleanProps(props) };
    this.parentId = null;
    this.children = [];
  }
}

export class Scene {
  constructor(data = []) {
    this.nodes = new Map();
    this.roots = [];
    this.load(data);
  }

  create(type, parentId = null, name = null) {
    const node = new SceneNode(type, name || type);
    this.insert(node, parentId);
    return node;
  }

  insert(node, parentId = null, index = null) {
    if (!(node instanceof SceneNode) || this.nodes.has(node.id)) throw new Error('Objeto inválido ou duplicado.');
    const parent = parentId ? this.get(parentId) : null;
    if (parentId && (!parent || parent.type !== 'Frame')) throw new Error('O destino precisa ser um Frame.');
    node.parentId = parentId;
    this.nodes.set(node.id, node);
    const list = parent ? parent.children : this.roots;
    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, list.length)) : list.length;
    list.splice(at, 0, node.id);
    return node;
  }

  get(id) { return this.nodes.get(id) || null; }

  duplicate(id) {
    const source = this.get(id);
    if (!source) throw new Error('Objeto não encontrado.');
    const siblings = source.parentId ? this.get(source.parentId)?.children : this.roots;
    const index = (siblings?.indexOf(id) ?? -1) + 1;
    const copyBranch = (original, parentId, at = null, isRoot = false) => {
      const copy = new SceneNode(original.type, original.name + ' cópia', original.props);
      this.insert(copy, parentId, at);
      original.children.forEach(childId => copyBranch(this.get(childId), copy.id));
      return copy;
    };
    return copyBranch(source, source.parentId, index, true);
  }

  descendants(id) {
    const result = [];
    const visit = key => {
      const node = this.get(key);
      if (!node) return;
      result.push(node);
      for (const childId of node.children) visit(childId);
    };
    visit(id);
    return result;
  }

  remove(id) {
    const node = this.get(id);
    if (!node) return false;
    const siblings = node.parentId ? this.get(node.parentId)?.children : this.roots;
    if (siblings) {
      const index = siblings.indexOf(id);
      if (index >= 0) siblings.splice(index, 1);
    }
    for (const item of this.descendants(id)) this.nodes.delete(item.id);
    return true;
  }

  reparent(id, parentId = null) {
    const node = this.get(id);
    const parent = parentId ? this.get(parentId) : null;
    if (!node) throw new Error('Objeto não encontrado.');
    if (parentId && (!parent || parent.type !== 'Frame')) throw new Error('O destino precisa ser um Frame.');
    if (id === parentId || (parentId && this.descendants(id).some(item => item.id === parentId))) throw new Error('Essa mudança criaria um ciclo.');
    const oldList = node.parentId ? this.get(node.parentId)?.children : this.roots;
    const oldIndex = oldList?.indexOf(id) ?? -1;
    if (oldIndex >= 0) oldList.splice(oldIndex, 1);
    node.parentId = parentId;
    (parent ? parent.children : this.roots).push(id);
  }

  load(data) {
    if (!Array.isArray(data)) throw new Error('Cena inválida.');
    if (data.length > 5000) throw new Error('A cena ultrapassa o limite de objetos.');
    this.nodes.clear();
    this.roots = [];
    let count = 0;
    const seen = new Set();
    const walk = (items, parentId, depth) => {
      if (depth > 40) throw new Error('A hierarquia ultrapassa o limite de profundidade.');
      for (const raw of items) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Objeto inválido na cena.');
        const type = raw.type || raw.className;
        if (!TYPES.has(type)) throw new Error('Tipo de objeto não permitido: ' + String(type));
        const id = typeof raw.id === 'string' && raw.id && !seen.has(raw.id) ? raw.id : ID();
        seen.add(id);
        const node = new SceneNode(type, raw.name, raw.props || raw.properties, id);
        this.insert(node, parentId);
        if (++count > 5000) throw new Error('A cena ultrapassa o limite de objetos.');
        const children = Array.isArray(raw.children) ? raw.children : [];
        if (children.length && type !== 'Frame') throw new Error('Somente Frames podem conter objetos.');
        walk(children, id, depth + 1);
      }
    };
    walk(data, null, 0);
    return this;
  }

  toJSON() {
    const encode = id => {
      const node = this.get(id);
      return { id: node.id, type: node.type, name: node.name, props: { ...node.props }, children: node.children.map(encode) };
    };
    return this.roots.map(encode);
  }

  snapshot() { return this.toJSON(); }
}

export const COMPONENTS = Object.freeze([
  { type: 'Frame', label: 'Frame', detail: 'Container para outros elementos' },
  { type: 'TextButton', label: 'TextButton', detail: 'Botão interativo' },
  { type: 'TextLabel', label: 'TextLabel', detail: 'Texto e títulos' },
  { type: 'ImageLabel', label: 'ImageLabel', detail: 'Imagem e mídia' }
]);
