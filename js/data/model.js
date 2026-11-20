const ID = () => globalThis.crypto?.randomUUID?.() || 'node_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
const TYPES = new Set(['Frame', 'ScrollingFrame', 'TextButton', 'ImageButton', 'TextLabel', 'ImageLabel', 'UIBackdrop', 'Script']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const normalizeZIndex = value => Math.max(-2147483648, Math.min(2147483647, Math.round(finite(value, 1))));
export const UDim = (scale = 0, offset = 0) => ({ scale: finite(scale), offset: finite(offset) });
export const UDim2 = (xScale = 0, xOffset = 0, yScale = 0, yOffset = 0) => ({
  x: UDim(xScale, xOffset),
  y: UDim(yScale, yOffset)
});
const DEFAULTS = Object.freeze({
  Frame: { x: 24, y: 24, width: 320, height: 220, position: UDim2(0, 24, 0, 24), size: UDim2(0, 320, 0, 220), anchorPoint: { x: 0, y: 0 }, background: '#1b2940', backgroundColor3: '#1b2940', backgroundTransparency: 0, radius: 0, opacity: 1, border: '#334155', borderColor3: '#334155', borderWidth: 0, borderSizePixel: 0, borderMode: 'Outline', rotation: 0, visible: true, archivable: true, clipsDescendants: false, active: false, interactable: true, selectable: false, selectionOrder: 0, layoutOrder: 0, zIndex: 1, automaticSize: 'None', sizeConstraint: 'RelativeXY', style: 'Custom' },
  ScrollingFrame: { x: 24, y: 24, width: 320, height: 220, position: UDim2(0, 24, 0, 24), size: UDim2(0, 320, 0, 220), anchorPoint: { x: 0, y: 0 }, backgroundColor3: '#1b2940', backgroundTransparency: 0, radius: 0, opacity: 1, borderColor3: '#334155', borderSizePixel: 0, visible: true, rotation: 0, zIndex: 1, clipsDescendants: true, scrollingEnabled: true, scrollingDirection: 'XY', automaticCanvasSize: 'None', canvasWidth: 0, canvasHeight: 0, scrollBarThickness: 8, elasticBehavior: 'WhenScrollable' },
  UIBackdrop: { x: 0, y: 0, width: 1, height: 1, position: UDim2(0, 0, 0, 0), size: UDim2(0, 1, 0, 1), anchorPoint: { x: 0, y: 0 }, enabled: true, effect: 'Blur', blur: 22, saturation: 1.35, brightness: 1.08, contrast: 1.08, tintColor: '#dbeafe', tintOpacity: 0.08, visible: true },
  Script: { source: 'on("click", "Botao", () => {\n  show("Painel");\n});' },
  TextButton: { x: 24, y: 24, width: 160, height: 48, position: UDim2(0, 24, 0, 24), size: UDim2(0, 160, 0, 48), anchorPoint: { x: 0, y: 0 }, backgroundColor3: '#2563eb', backgroundTransparency: 0, textColor3: '#ffffff', radius: 10, textSize: 15, fontFace: 'Arial', fontWeight: '500', text: 'Botão', textTransparency: 0, textScaled: false, textWrapped: false, textXAlignment: 'Center', textYAlignment: 'Center', richText: false, lineHeight: 1, opacity: 1, visible: true, borderColor3: '#334155', borderSizePixel: 0, autoButtonColor: true, interactable: true, zIndex: 1 },
  ImageButton: { x: 24, y: 24, width: 140, height: 120, position: UDim2(0, 24, 0, 24), size: UDim2(0, 140, 0, 120), anchorPoint: { x: 0, y: 0 }, backgroundColor3: '#24344c', backgroundTransparency: 0, radius: 10, assetId: '', hoverAssetId: '', pressedAssetId: '', imageColor3: '#ffffff', imageTransparency: 0, fit: 'contain', tileSize: UDim2(0, 64, 0, 64), autoButtonColor: true, interactable: true, opacity: 1, visible: true, borderColor3: '#334155', borderSizePixel: 0, zIndex: 1 },
  TextLabel: { x: 24, y: 24, width: 220, height: 42, position: UDim2(0, 24, 0, 24), size: UDim2(0, 220, 0, 42), anchorPoint: { x: 0, y: 0 }, background: '#a3a2a5', backgroundColor3: '#a3a2a5', backgroundTransparency: 0, color: '#000000', textColor3: '#000000', textTransparency: 0, fontFace: 'Arial', fontWeight: '400', textSize: 14, textScaled: false, textWrapped: false, textXAlignment: 'Center', textYAlignment: 'Center', richText: false, lineHeight: 1, radius: 0, fontSize: 14, text: 'Label', opacity: 1, visible: true, border: '#000000', borderWidth: 0, zIndex: 1 },
  ImageLabel: { x: 24, y: 24, width: 140, height: 120, position: UDim2(0, 24, 0, 24), size: UDim2(0, 140, 0, 120), anchorPoint: { x: 0, y: 0 }, background: '#24344c', backgroundColor3: '#24344c', backgroundTransparency: 0, color: '#ffffff', radius: 10, opacity: 1, visible: true, border: '#334155', borderWidth: 0, assetId: '', fit: 'cover', imageTransparency: 0, imageColor3: '#ffffff', tileSize: UDim2(0, 64, 0, 64), zIndex: 1 }
});
const cleanName = (value, fallback) => String(value ?? '').trim().slice(0, 64) || fallback;
const cleanProps = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    if (['position', 'size', 'anchorPoint'].includes(key) && item && typeof item === 'object' && !Array.isArray(item)) {
      const pair = {};
      for (const axis of ['x', 'y']) {
        const source = item[axis];
        if (source && typeof source === 'object' && !Array.isArray(source)) {
          pair[axis] = { scale: finite(source.scale), offset: finite(source.offset) };
        } else if (key === 'anchorPoint') pair[axis] = finite(source);
      }
      out[key] = pair;
    } else if (['string', 'number', 'boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item))) out[key] = item;
  }
  return out;
};

function normalizeLayout(props) {
  const position = props.position && typeof props.position === 'object' ? props.position : {};
  const size = props.size && typeof props.size === 'object' ? props.size : {};
  const anchor = props.anchorPoint && typeof props.anchorPoint === 'object' ? props.anchorPoint : {};
  props.position = {
    x: { scale: finite(position.x?.scale), offset: finite(position.x?.offset, finite(props.x, 0)) },
    y: { scale: finite(position.y?.scale), offset: finite(position.y?.offset, finite(props.y, 0)) }
  };
  props.size = {
    x: { scale: finite(size.x?.scale), offset: finite(size.x?.offset, finite(props.width, 1)) },
    y: { scale: finite(size.y?.scale), offset: finite(size.y?.offset, finite(props.height, 1)) }
  };
  props.anchorPoint = {
    x: Math.max(0, Math.min(1, finite(anchor.x))),
    y: Math.max(0, Math.min(1, finite(anchor.y)))
  };
  // Legacy aliases keep existing editor tools and old project data compatible.
  props.x = props.position.x.offset;
  props.y = props.position.y.offset;
  props.width = props.size.x.offset;
  props.height = props.size.y.offset;
  return props;
}

export function resolveNodeLayout(node, parentWidth, parentHeight) {
  const p = node.props;
  const constraint = p.sizeConstraint || 'RelativeXY';
  const widthBase = constraint === 'RelativeYY' ? parentHeight : parentWidth;
  const heightBase = constraint === 'RelativeXX' ? parentWidth : parentHeight;
  const width = Math.max(1, widthBase * p.size.x.scale + p.size.x.offset);
  const height = Math.max(1, heightBase * p.size.y.scale + p.size.y.offset);
  return {
    x: parentWidth * p.position.x.scale + p.position.x.offset - width * p.anchorPoint.x,
    y: parentHeight * p.position.y.scale + p.position.y.offset - height * p.anchorPoint.y,
    width, height
  };
}

export class SceneNode {
  constructor(type, name, props = {}, id = ID()) {
    if (!TYPES.has(type)) throw new Error('Tipo de objeto não reconhecido.');
    this.id = id;
    this.type = type;
    this.name = cleanName(name, type);
    const clean = cleanProps(props);
    const merged = { rotation: 0, ...DEFAULTS[type], ...clean };
    // Blur is the only supported material. Older effect values migrate safely.
    if (type === 'UIBackdrop') { merged.effect = 'Blur'; delete merged.glassBorder; }
    else merged.zIndex = normalizeZIndex(merged.zIndex);
    if (['TextButton', 'ImageButton', 'TextLabel', 'ImageLabel'].includes(type)) merged.radius = 0;
    if (type === 'TextButton') {
      if (Object.hasOwn(clean, 'background') && !Object.hasOwn(clean, 'backgroundColor3')) merged.backgroundColor3 = clean.background;
      if (Object.hasOwn(clean, 'color') && !Object.hasOwn(clean, 'textColor3')) merged.textColor3 = clean.color;
      if (Object.hasOwn(clean, 'fontSize') && !Object.hasOwn(clean, 'textSize')) merged.textSize = clean.fontSize;
      if (Object.hasOwn(clean, 'textAlign') && !Object.hasOwn(clean, 'textXAlignment')) merged.textXAlignment = clean.textAlign === 'left' ? 'Left' : clean.textAlign === 'right' ? 'Right' : 'Center';
    }
    if (!Object.hasOwn(clean, 'position')) merged.position = {
      x: { scale: 0, offset: finite(clean.x, DEFAULTS[type].x) },
      y: { scale: 0, offset: finite(clean.y, DEFAULTS[type].y) }
    };
    if (!Object.hasOwn(clean, 'size')) merged.size = {
      x: { scale: 0, offset: finite(clean.width, DEFAULTS[type].width) },
      y: { scale: 0, offset: finite(clean.height, DEFAULTS[type].height) }
    };
    this.props = normalizeLayout(merged);
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
    if (parentId && !parent) throw new Error('O objeto pai não foi encontrado.');
    if (parent?.type === 'UIBackdrop') throw new Error('UIBackdrop não aceita objetos filhos.');
    if (node.type === 'UIBackdrop' && parent?.type !== 'Frame') throw new Error('UIBackdrop precisa ser filho de um Frame.');
    if (node.type === 'UIBackdrop' && parent.children.some(childId => this.get(childId)?.type === 'UIBackdrop')) throw new Error('Este Frame já possui um UIBackdrop.');
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
    const copyBranch = (original, parentId, at = null) => {
      const copy = new SceneNode(original.type, original.name + ' cópia', original.props);
      this.insert(copy, parentId, at);
      original.children.forEach(childId => copyBranch(this.get(childId), copy.id));
      return copy;
    };
    return copyBranch(source, source.parentId, index);
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

  reparent(id, parentId = null, index = null) {
    const node = this.get(id);
    const parent = parentId ? this.get(parentId) : null;
    if (!node) throw new Error('Objeto não encontrado.');
    if (parentId && !parent) throw new Error('O destino não foi encontrado.');
    if (parent?.type === 'UIBackdrop') throw new Error('UIBackdrop não aceita objetos filhos.');
    if (node.type === 'UIBackdrop' && parent?.type !== 'Frame') throw new Error('UIBackdrop precisa ser filho de um Frame.');
    if (node.type === 'UIBackdrop' && parent.children.some(childId => childId !== id && this.get(childId)?.type === 'UIBackdrop')) throw new Error('Este Frame já possui um UIBackdrop.');
    if (id === parentId || (parentId && this.descendants(id).some(item => item.id === parentId))) throw new Error('Essa mudança criaria um ciclo.');
    const oldList = node.parentId ? this.get(node.parentId)?.children : this.roots;
    const oldIndex = oldList?.indexOf(id) ?? -1;
    if (oldIndex >= 0) oldList.splice(oldIndex, 1);
    node.parentId = parentId;
    const nextList = parent ? parent.children : this.roots;
    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, nextList.length)) : nextList.length;
    nextList.splice(at, 0, id);
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
        walk(children, id, depth + 1);
      }
    };
    walk(data, null, 0);
    return this;
  }

  toJSON() {
    const encode = id => {
      const node = this.get(id);
      return { id: node.id, type: node.type, name: node.name, props: { ...node.props, position: { x: { ...node.props.position.x }, y: { ...node.props.position.y } }, size: { x: { ...node.props.size.x }, y: { ...node.props.size.y } }, anchorPoint: { ...node.props.anchorPoint } }, children: node.children.map(encode) };
    };
    return this.roots.map(encode);
  }

  snapshot() { return this.toJSON(); }
}

export const COMPONENTS = Object.freeze([
  { type: 'Frame', label: 'Frame', category: 'Contêineres', detail: 'Container para outros elementos' },
  { type: 'ScrollingFrame', label: 'ScrollingFrame', category: 'Contêineres', detail: 'Container rolável com elasticidade e canvas' },
  { type: 'UIBackdrop', label: 'UIBackdrop', category: 'Aparência', detail: 'Material e efeitos atrás do fundo do Frame' },
  { type: 'TextButton', label: 'TextButton', category: 'Interação', detail: 'Botão de texto com evento Activated' },
  { type: 'ImageButton', label: 'ImageButton', category: 'Interação', detail: 'Botão de imagem com estados normal, hover e pressionado' },
  { type: 'TextLabel', label: 'TextLabel', category: 'Texto', detail: 'Texto e títulos' },
  { type: 'ImageLabel', label: 'ImageLabel', category: 'Mídia', detail: 'Imagem e mídia' },
  { type: 'Script', label: 'Script', category: 'Scripting', detail: 'Código FlowScript independente para controlar a interface' }
]);
