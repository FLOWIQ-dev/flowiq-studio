import { resolveNodeLayout } from '../data/model.js';
import { getPropertySchema } from './property-schema.js';
const $ = id => document.getElementById(id);
const ICONS = {
  Frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/>',
  TextButton: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 9h8M12 9v6m-3 0h6"/>',
  TextLabel: '<path d="M4 6h16M12 6v13M8 19h8"/>',
  ImageLabel: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/>'
};
const icon = type => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[type] || ICONS.Frame) + '</svg>';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderScene(container, scene, { selectedId = null, preview = false, assets = [], onRun = () => {}, sceneSize = { width: 960, height: 640 }, zoom = 1, cameraOffset = { x: 0, y: 0 } } = {}) {
  const existingNodes = new Map(Array.from(container.querySelectorAll('.scene-world [data-node-id]')).map(item => [item.dataset.nodeId, item]));
  const assetUrls = container._assetObjectUrls || (container._assetObjectUrls = new Map());
  const usedAssetIds = new Set();
  container.replaceChildren();
  // A viewport define o espaço lógico atual. A câmera aplica zoom apenas aos objetos.
  const rootWidth = Math.max(1, Number(sceneSize.width) || container.clientWidth || 960);
  const rootHeight = Math.max(1, Number(sceneSize.height) || container.clientHeight || 640);
  container.style.position = 'relative';
  const world = el('div', 'scene-world');
  world.style.width = rootWidth + 'px';
  world.style.height = rootHeight + 'px';
  world.style.transformOrigin = preview ? 'top left' : '50% 50%';
  const safeZoom = Math.max(0.25, Math.min(2.5, Number(zoom) || 1));
  const offsetX = preview ? 0 : Number(cameraOffset?.x) || 0;
  const offsetY = preview ? 0 : Number(cameraOffset?.y) || 0;
  world.style.transform = preview ? 'scale(' + safeZoom + ')' : 'translate3d(' + offsetX + 'px,' + offsetY + 'px,0) scale(' + safeZoom + ')';
  container.append(world);
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));
  const measureLayout = (node, parentWidth, parentHeight) => {
    const layout = resolveNodeLayout(node, parentWidth, parentHeight);
    const automatic = node.props.automaticSize || 'None';
    if (automatic === 'None' || !node.children.length) return layout;
    for (let pass = 0; pass < 4; pass++) {
      let contentWidth = 0;
      let contentHeight = 0;
      for (const childId of node.children) {
        const child = scene.get(childId);
        if (!child || child.type === 'UIBackdrop') continue;
        const bounds = measureLayout(child, layout.width, layout.height);
        contentWidth = Math.max(contentWidth, bounds.x + bounds.width);
        contentHeight = Math.max(contentHeight, bounds.y + bounds.height);
      }
      if (automatic === 'X' || automatic === 'XY') layout.width = Math.max(1, contentWidth);
      if (automatic === 'Y' || automatic === 'XY') layout.height = Math.max(1, contentHeight);
      layout.x = parentWidth * node.props.position.x.scale + node.props.position.x.offset - layout.width * node.props.anchorPoint.x;
      layout.y = parentHeight * node.props.position.y.scale + node.props.position.y.offset - layout.height * node.props.anchorPoint.y;
    }
    return layout;
  };
  const build = (id, parent, parentWidth, parentHeight) => {
    const node = scene.get(id);
    if (!node || node.props.visible === false || node.type === 'UIBackdrop') return;
    const p = node.props;
    const existing = existingNodes.get(node.id);
    const item = existing && existing.tagName.toLowerCase() === (node.type === 'TextButton' && preview ? 'button' : 'div')
      ? existing
      : el(node.type === 'TextButton' && preview ? 'button' : 'div', 'scene-node scene-' + node.type.toLowerCase());
    item.className = 'scene-node scene-' + node.type.toLowerCase();
    item.dataset.nodeId = node.id;
    const layout = measureLayout(node, parentWidth, parentHeight);
    item.style.left = (layout.x + layout.width * p.anchorPoint.x) + 'px';
    item.style.top = (layout.y + layout.height * p.anchorPoint.y) + 'px';
    item.style.width = layout.width + 'px';
    item.style.height = layout.height + 'px';
    item.style.transform = 'translate(' + (-p.anchorPoint.x * 100) + '%,' + (-p.anchorPoint.y * 100) + '%) rotate(' + (Number(p.rotation) || 0) + 'deg)';
    const isFrame = node.type === 'Frame';
    const backdropNode = isFrame ? node.children.map(childId => scene.get(childId)).find(child => child?.type === 'UIBackdrop') : null;
    item.style.background = isFrame ? 'transparent' : (p.background || 'transparent');
    item.style.opacity = String(Math.max(0, Math.min(1, Number(p.opacity ?? 1))));
    if (isFrame) {
      const bg = String(p.backgroundColor3 || p.background || 'transparent');
      const alpha = 1 - Math.max(0, Math.min(1, Number(p.backgroundTransparency) || 0));
      const match = bg.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      let fillColor = bg;
      if (match) {
        const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
        fillColor = 'rgba(' + [0,2,4].map(index => parseInt(hex.slice(index,index+2),16)).join(',') + ',' + alpha + ')';
      }
      if (p.style === 'ChatBlue') fillColor = 'rgba(36,84,135,' + alpha + ')';
      if (p.style === 'ChatGreen') fillColor = 'rgba(35,112,75,' + alpha + ')';
      if (p.style === 'ChatRed') fillColor = 'rgba(137,48,55,' + alpha + ')';
      item.dataset.clipsDescendants = String(Boolean(p.clipsDescendants));
      item.style.zIndex = String(Math.max(1, Math.min(10, Number(p.zIndex) || 1)));
      item.style.border = '0';
      item.style.outline = 'none';
      item.style.backgroundColor = fillColor;
      item.style.backgroundImage = 'none';
      item.style.boxShadow = p.style === 'DropShadow' ? '0 5px 14px rgba(0,0,0,.28)' : 'none';
      const backdrop = backdropNode?.props || {};
      const backdropVisible = Boolean(backdrop.enabled) && backdropNode?.props.visible !== false && alpha < 1;
      item.style.backdropFilter = backdropVisible
        ? 'blur(' + Math.max(0, Math.min(40, Number(backdrop.blur) || 0)) + 'px) saturate(' + Math.max(0, Math.min(3, Number(backdrop.saturation) || 0)) + ') brightness(' + Math.max(0.5, Math.min(1.5, Number(backdrop.brightness) || 1)) + ') contrast(' + Math.max(0.5, Math.min(1.5, Number(backdrop.contrast) || 1)) + ')'
        : 'none';
      item.style.webkitBackdropFilter = item.style.backdropFilter;
      if (backdropVisible) {
        const tint = String(backdrop.tintColor || '#dbeafe');
        const tintMatch = tint.match(/^#([0-9a-f]{6})$/i);
        const tintHex = tintMatch ? tintMatch[1] : 'dbeafe';
        const tintRgb = [0,2,4].map(index => parseInt(tintHex.slice(index,index+2),16)).join(',');
        const tintAlpha = Math.max(0, Math.min(1, Number(backdrop.tintOpacity) || 0));
        if (backdrop.effect === 'LiquidGlass') {
          const shine = Math.max(0, Math.min(1, Number(backdrop.highlight) || 0));
          const refract = Math.max(0, Math.min(1, Number(backdrop.refraction) || 0));
          item.style.backgroundImage = 'linear-gradient(145deg,rgba(255,255,255,' + (0.12 + shine * 0.2) + '),rgba(' + tintRgb + ',' + tintAlpha + ') 42%,rgba(255,255,255,' + (0.025 + refract * 0.07) + '))';
          item.style.boxShadow = (p.style === 'DropShadow' ? '0 5px 14px rgba(0,0,0,.28),' : '') + 'inset 0 1px 0 rgba(255,255,255,' + (0.25 + shine * 0.45) + '),inset 0 -1px 0 rgba(255,255,255,' + (0.08 + refract * 0.12) + ')';
        } else if (backdrop.effect === 'FrostedGlass') {
          item.style.backgroundImage = 'linear-gradient(rgba(' + tintRgb + ',' + Math.max(tintAlpha, 0.16) + '),rgba(' + tintRgb + ',' + Math.max(tintAlpha, 0.16) + '))';
        } else if (backdrop.effect === 'Acrylic') {
          item.style.backgroundImage = 'linear-gradient(135deg,rgba(255,255,255,.09),rgba(' + tintRgb + ',' + tintAlpha + '))';
        } else if (tintAlpha > 0) {
          item.style.backgroundImage = 'linear-gradient(rgba(' + tintRgb + ',' + tintAlpha + '),rgba(' + tintRgb + ',' + tintAlpha + '))';
        }
      }
    } else {
      item.style.borderRadius = Math.max(0, Number(p.radius) || 0) + 'px';
      item.style.border = Math.max(0, Number(p.borderWidth) || 0) + 'px solid ' + (p.border || 'transparent');
    }
    item.style.color = p.color || '#ffffff';
    item.style.fontSize = Math.max(8, Number(p.fontSize) || 16) + 'px';
    item.style.textAlign = p.textAlign || 'center';
    item.style.fontWeight = p.fontWeight || '500';
    item.textContent = node.type === 'Frame' ? '' : (p.text || (node.type === 'ImageLabel' ? '' : node.name));
    const childContainer = item.querySelector(':scope > .scene-children') || el('div', 'scene-children');
    childContainer.replaceChildren();
    childContainer.style.position = 'absolute';
    childContainer.style.inset = '0';
    childContainer.style.overflow = node.type === 'Frame' && p.clipsDescendants ? 'hidden' : 'visible';
    if (isFrame) childContainer.style.zIndex = '2';
    for (const child of Array.from(item.children)) if (child !== childContainer) child.remove();
    item.append(childContainer);
    if (node.type === 'ImageLabel') {
      const asset = assetMap.get(p.assetId);
      if (asset?.blob) {
        usedAssetIds.add(asset.id);
        let cached = assetUrls.get(asset.id);
        if (!cached || cached.blob !== asset.blob) {
          if (cached?.url) URL.revokeObjectURL(cached.url);
          cached = { blob: asset.blob, url: URL.createObjectURL(asset.blob) };
          assetUrls.set(asset.id, cached);
        }
        const imageUrl = 'url("' + cached.url + '")';
        if (item.style.backgroundImage !== imageUrl && !item.style.backgroundImage.includes('linear-gradient')) item.style.backgroundImage = imageUrl;
        item.style.backgroundSize = p.fit || 'cover';
        item.style.backgroundPosition = 'center';
        item.style.backgroundRepeat = 'no-repeat';
        item.dataset.assetId = asset.id;
      } else {
        item.style.backgroundImage = 'none';
        delete item.dataset.assetId;
      }
      item.setAttribute('aria-label', node.name);
    }
    if (selectedId === node.id && !preview) item.classList.add('is-selected');
    if (preview && node.type === 'TextButton') item.addEventListener('click', event => { event.stopPropagation(); onRun(node, 'click'); });
    parent.append(item);
    for (const childId of node.children) build(childId, childContainer, layout.width, layout.height);
    if (selectedId === node.id && !preview) {
      for (const direction of ['nw','n','ne','e','se','s','sw','w']) {
        const handle = el('button', 'resize-handle handle-' + direction);
        handle.type = 'button'; handle.dataset.resize = direction; handle.setAttribute('aria-label', 'Redimensionar ' + direction);
        item.append(handle);
      }
      const rotate = el('button', 'rotate-handle'); rotate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></svg>';
      rotate.style.transform = 'rotate(' + (-(Number(p.rotation) || 0)) + 'deg)';
      rotate.type = 'button'; rotate.dataset.rotate = 'true'; rotate.setAttribute('aria-label', 'Girar objeto');
      item.append(rotate);
    }
  };
  for (const id of scene.roots) build(id, world, rootWidth, rootHeight);
  for (const [assetId, cached] of assetUrls) {
    if (!usedAssetIds.has(assetId)) {
      URL.revokeObjectURL(cached.url);
      assetUrls.delete(assetId);
    }
  }
}

export function updateSceneLayout(container, scene, sceneSize = { width: 960, height: 640 }) {
  const rootWidth = Math.max(1, Number(sceneSize.width) || 960);
  const rootHeight = Math.max(1, Number(sceneSize.height) || 640);
  const measure = (node, parentWidth, parentHeight) => {
    const layout = resolveNodeLayout(node, parentWidth, parentHeight);
    const automatic = node.props.automaticSize || 'None';
    if (automatic !== 'None' && node.children.length) {
      for (let pass = 0; pass < 4; pass++) {
        let contentWidth = 0, contentHeight = 0;
        for (const childId of node.children) {
          const child = scene.get(childId);
          if (!child) continue;
          const bounds = measure(child, layout.width, layout.height);
          contentWidth = Math.max(contentWidth, bounds.x + bounds.width);
          contentHeight = Math.max(contentHeight, bounds.y + bounds.height);
        }
        if (automatic === 'X' || automatic === 'XY') layout.width = Math.max(1, contentWidth);
        if (automatic === 'Y' || automatic === 'XY') layout.height = Math.max(1, contentHeight);
        layout.x = parentWidth * node.props.position.x.scale + node.props.position.x.offset - layout.width * node.props.anchorPoint.x;
        layout.y = parentHeight * node.props.position.y.scale + node.props.position.y.offset - layout.height * node.props.anchorPoint.y;
      }
    }
    return layout;
  };
  const visit = (id, parentElement, parentWidth, parentHeight) => {
    const node = scene.get(id);
    const element = parentElement.querySelector(':scope > [data-node-id="' + CSS.escape(id) + '"]');
    if (!node || !element) return;
    const layout = measure(node, parentWidth, parentHeight);
    const p = node.props;
    element.style.left = (layout.x + layout.width * p.anchorPoint.x) + 'px';
    element.style.top = (layout.y + layout.height * p.anchorPoint.y) + 'px';
    element.style.width = layout.width + 'px';
    element.style.height = layout.height + 'px';
    element.style.transform = 'translate(' + (-p.anchorPoint.x * 100) + '%,' + (-p.anchorPoint.y * 100) + '%) rotate(' + (Number(p.rotation) || 0) + 'deg)';
    const children = element.querySelector(':scope > .scene-children');
    if (children) for (const childId of node.children) visit(childId, children, layout.width, layout.height);
  };
  for (const id of scene.roots) visit(id, container.querySelector('.scene-world'), rootWidth, rootHeight);
}

export function renderTree(container, scene, selectedId, { search = '', expanded = new Set(), onSelect = () => {}, onToggle = () => {} } = {}) {
  container.replaceChildren();
  const list = el('div', 'tree-list');
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const matches = new Set();
  const include = id => {
    const node = scene.get(id);
    if (!node) return false;
    const own = !query || (node.name + ' ' + node.type).toLocaleLowerCase('pt-BR').includes(query);
    let childMatch = false;
    node.children.forEach(childId => { if (include(childId)) childMatch = true; });
    if (own || childMatch) matches.add(id);
    return own || childMatch;
  };
  scene.roots.forEach(include);
  // Build a recursive tree directly, preserving the scene's sibling order.
  const build = (id, depth) => {
    const node = scene.get(id);
    if (!node || !matches.has(id)) return null;
    const branch = el('div', 'tree-branch');
    const row = el('div', 'tree-row' + (node.id === selectedId ? ' is-active' : ''));
    row.dataset.treeNode = node.id;
    row.style.setProperty('--depth', depth);
    const isOpen = expanded.has(id) || Boolean(query);
    const toggle = el('button', 'tree-disclosure', node.children.length ? (isOpen ? '⌄' : '›') : '');
    toggle.type = 'button'; toggle.dataset.treeToggle = id; toggle.disabled = !node.children.length;
    toggle.setAttribute('aria-label', isOpen ? 'Recolher' : 'Expandir');
    const marker = el('span', 'tree-marker'); marker.innerHTML = icon(node.type);
    const name = el('span', 'tree-name', node.name);
    const type = el('span', 'tree-type', node.type);
    const menu = el('button', 'tree-menu-trigger', '⋯'); menu.type = 'button'; menu.dataset.treeMenu = id;
    menu.setAttribute('aria-label', 'Opções de ' + node.name);
    row.append(toggle, marker, name, type, menu);
    branch.append(row);
    if (node.children.length && isOpen) {
      const children = el('div', 'tree-children');
      node.children.forEach(childId => { const child = build(childId, depth + 1); if (child) children.append(child); });
      branch.append(children);
    }
    return branch;
  };
  scene.roots.forEach(id => { const branch = build(id, 0); if (branch) list.append(branch); });
  if (!list.childElementCount) list.append(el('p', 'empty-inline', query ? 'Nenhum objeto encontrado.' : 'Seu projeto ainda não tem objetos.'));
  const rootStart = el('div', 'tree-root-start-drop', 'Mover para o topo · nível raiz');
  rootStart.dataset.treeRootStart = 'true';
  container.append(rootStart, list);
}

export function renderInspector(container, node, { onChange, onDelete, onDuplicate, onEditStart, onPreview, onCommit, assets = [], onAsset, events = [], nodes = [], onEventSave } = {}) {
  const previousScrollTop = container.scrollTop;
  container.replaceChildren();
  const toolbarHost = container.closest('.inspector-panel')?.querySelector('.inspector-toolbar-actions');
  if (toolbarHost) { toolbarHost.replaceChildren(); toolbarHost.hidden = true; }
  if (!node) {
    container.append(el('p', 'inspector-empty', 'Selecione um objeto no palco ou na hierarquia para editar suas propriedades.'));
    return;
  }
  const heading = el('div', 'inspector-heading');
  heading.append(el('span', 'eyebrow', node.type.toUpperCase()), el('strong', '', node.name));
  container.append(heading);
  const toolbar = container.closest('.inspector-panel')?.querySelector('.inspector-toolbar-actions');
  if (toolbar) {
    toolbar.replaceChildren();
    const makeAction = (label, path, callback, danger = false) => {
      const button = el('button', 'icon-button inspector-toolbar-button' + (danger ? ' danger-text' : ''));
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
      button.addEventListener('click', () => callback?.());
      toolbar.append(button);
    };
    makeAction('Duplicar instância', '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', onDuplicate);
    makeAction('Excluir instância', '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', onDelete, true);
    toolbar.hidden = false;
  }

  const readValue = key => key.split('.').reduce((value, part) => value?.[part], key === 'name' ? { name: node.name } : node.props);
  const field = descriptor => {
    const { key, label: labelText, type = 'number' } = descriptor;
    const wrap = el('label', 'property-field');
    if (type !== 'udim2' && type !== 'vector2') wrap.append(el('span', '', labelText));
    let input;
    if (type === 'select' || type === 'asset') {
      input = el('select');
      const values = type === 'asset'
        ? [{ value: '', label: 'Nenhum arquivo' }, ...assets.filter(asset => !descriptor.accept || asset.mime?.startsWith(descriptor.accept.replace('/*', '/'))).map(asset => ({ value: asset.id, label: asset.name }))]
        : (descriptor.values || []);
      values.forEach(value => {
        const option = el('option', '', value.label);
        option.value = value.value;
        input.append(option);
      });
    } else {
      input = el('input');
      input.type = type === 'slider' ? 'range' : type;
      if (type === 'number' || type === 'slider') {
        input.min = descriptor.min ?? '0';
        input.max = descriptor.max ?? '2000';
        input.step = descriptor.step ?? '1';
      }
    }
    const propertyValue = readValue(key);
    if (type === 'udim2' || type === 'vector2') {
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = type === 'udim2' ? '0, 30, 0, 20' : '0, 0';
      const tuple = value => (type === 'udim2' ? [value?.x?.scale ?? 0, value?.x?.offset ?? 0, value?.y?.scale ?? 0, value?.y?.offset ?? 0] : [value?.x ?? 0, value?.y ?? 0]).map(number => Number(number)).join(', ');
      input.value = tuple(propertyValue);
      input.classList.add('udim2-input');
      const parse = raw => {
        const parts = raw.trim().split(/[;,\\s]+/).filter(Boolean);
        const expected = type === 'udim2' ? 4 : 2;
        if (parts.length !== expected || parts.some(part => !Number.isFinite(Number(part)))) return null;
        return type === 'udim2' ? { x: { scale: Number(parts[0]), offset: Number(parts[1]) }, y: { scale: Number(parts[2]), offset: Number(parts[3]) } } : { x: Number(parts[0]), y: Number(parts[1]) };
      };
      const preview = () => {
        const value = parse(input.value);
        input.setAttribute('aria-invalid', String(!value));
        if (value) onPreview?.(key, value);
      };
      const begin = () => onEditStart?.(key);
      input.addEventListener('pointerdown', begin);
      input.addEventListener('focus', begin);
      input.addEventListener('keydown', begin);
      input.addEventListener('input', preview);
      input.addEventListener('change', () => {
        const value = parse(input.value);
        if (!value) { input.value = tuple(readValue(key)); input.removeAttribute('aria-invalid'); return; }
        input.removeAttribute('aria-invalid');
        if (onCommit) onCommit(key, value); else onChange(key, value);
      });
    } else if (type === 'checkbox') input.checked = Boolean(propertyValue);
    else input.value = String(propertyValue ?? descriptor.fallback ?? '');
    if (type === 'udim2' || type === 'vector2') {
      wrap.append(input);
    } else if (type === 'slider') {
      const format = value => Number(value).toFixed(descriptor.step < 1 ? 2 : 0);
      const valueInput = el('input', 'property-slider-value');
      valueInput.type = 'number';
      valueInput.inputMode = 'decimal';
      valueInput.min = input.min;
      valueInput.max = input.max;
      valueInput.step = input.step;
      valueInput.value = format(input.value);
      valueInput.setAttribute('aria-label', labelText + ' valor');
      const begin = () => onEditStart?.(key);
      const preview = raw => {
        if (raw === '' || !Number.isFinite(Number(raw))) return;
        const next = Math.max(Number(input.min), Math.min(Number(input.max), Number(raw)));
        input.value = String(next);
        valueInput.value = format(next);
        onPreview?.(key, next);
      };
      for (const control of [input, valueInput]) {
        control.addEventListener('pointerdown', begin);
        control.addEventListener('focus', begin);
        control.addEventListener('keydown', begin);
      }
      input.addEventListener('input', () => {
        valueInput.value = format(input.value);
        onPreview?.(key, Number(input.value));
      });
      valueInput.addEventListener('input', () => preview(valueInput.value));
      const commit = () => {
        const next = Number(input.value);
        valueInput.value = format(next);
        if (onCommit) onCommit(key, next); else onChange(key, next);
      };
      input.addEventListener('change', commit);
      valueInput.addEventListener('change', commit);
      wrap.append(input, valueInput);
    } else {
      if (type === 'number' || type === 'color') {
        const begin = () => onEditStart?.(key);
        input.addEventListener('pointerdown', begin);
        input.addEventListener('focus', begin);
        input.addEventListener('keydown', begin);
        input.addEventListener('input', () => onPreview?.(key, type === 'number' ? Number(input.value) : input.value));
        input.addEventListener('change', () => onCommit ? onCommit(key, type === 'number' ? Number(input.value) : input.value) : onChange(key, type === 'number' ? Number(input.value) : input.value));
      } else {
        input.addEventListener('change', () => {
          const value = type === 'checkbox' ? input.checked : input.value;
          if (type === 'asset') onAsset?.(value);
          else onChange(key, value);
        });
      }
      wrap.append(input);
    }
    return wrap;
  };

  const filterWrap = el('label', 'inspector-filter');
  filterWrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>';
  const filter = el('input');
  filter.type = 'search';
  filter.placeholder = 'Filtrar propriedades';
  filter.setAttribute('aria-label', 'Filtrar propriedades');
  filterWrap.append(filter);
  container.append(filterWrap);
  const schema = getPropertySchema(node.type);
  const groups = [];
  schema.sections.forEach(definition => {
    const group = el('section', 'property-group');
    group.dataset.propertyCategory = definition.title;
    const toggle = el('button', 'property-group-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg><span>' + definition.title + '</span>';
    const body = el('div', 'property-group-body');
    const subgroups = new Map();
    definition.fields.forEach(descriptor => {
      const control = field(descriptor);
      control.dataset.propertySearch = (descriptor.label + ' ' + descriptor.key + ' ' + definition.title + ' ' + (descriptor.subgroup || '')).toLocaleLowerCase('pt-BR');
      if (descriptor.enabledOnly || descriptor.effectOnly) {
        control.dataset.effectOnly = (descriptor.effectOnly || []).join(',');
        const enabled = Boolean(node.props.enabled);
        const effect = node.props.effect || 'Blur';
        control.hidden = (descriptor.enabledOnly && !enabled) || (descriptor.effectOnly && !descriptor.effectOnly.includes(effect));
      }
      if (descriptor.subgroup) {
        let subgroup = subgroups.get(descriptor.subgroup);
        if (!subgroup) {
          subgroup = el('div', 'property-subgroup');
          subgroup.dataset.subgroup = descriptor.subgroup;
          subgroup.append(el('div', 'property-subgroup-title', descriptor.subgroup));
          const fields = el('div', 'property-subgroup-fields');
          subgroup.append(fields);
          subgroups.set(descriptor.subgroup, subgroup);
          body.append(subgroup);
        }
        subgroup.querySelector('.property-subgroup-fields').append(control);
      } else body.append(control);
    });
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });
    group.append(toggle, body);
    container.append(group);
    groups.push({ group, body, toggle });
  });
  filter.addEventListener('input', () => {
    const term = filter.value.trim().toLocaleLowerCase('pt-BR');
    groups.forEach(({ group, body, toggle }) => {
      let matches = 0;
      body.querySelectorAll('[data-property-search]').forEach(control => {
        const visible = !term || control.dataset.propertySearch.includes(term);
        control.hidden = !visible;
        if (visible) matches++;
      });
      group.hidden = matches === 0;
      if (term) { body.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
    });
  });

  if (node.type === 'TextButton') {
    const logic = el('section', 'property-group logic-group');
    logic.append(el('h3', '', 'Interações'));
    const rule = events.find(item => item && item.nodeId === node.id && item.event === 'click');
    const available = nodes.filter(item => item && item.id !== node.id);
    const actionTypes = [
      { value: 'setText', label: 'Alterar texto' },
      { value: 'setProperty', label: 'Alterar propriedade' },
      { value: 'toggleVisibility', label: 'Mostrar / ocultar' },
      { value: 'log', label: 'Registrar mensagem' }
    ];
    const targetSelect = (action, index) => {
      const label = el('label', 'property-field');
      label.append(el('span', '', 'Objeto afetado'));
      const select = el('select');
      const self = el('option', '', 'Este botão'); self.value = ''; select.append(self);
      available.forEach(item => { const option = el('option', '', item.name); option.value = item.id; select.append(option); });
      select.value = action.targetId || '';
      select.addEventListener('change', () => { const next = actions.map((item, i) => i === index ? { ...item, targetId: select.value } : item); onEventSave?.(node.id, next); });
      label.append(select); return label;
    };
    const actions = Array.isArray(rule?.actions) ? rule.actions : [];
    if (!rule) {
      const hint = el('p', 'event-editor-note', 'Defina o que acontece quando alguém tocar neste botão na prévia.');
      const create = el('button', 'button subtle', 'Criar evento Ao clicar');
      create.type = 'button'; create.addEventListener('click', () => onEventSave?.(node.id, []));
      logic.append(hint, create);
    } else {
      actions.forEach((action, index) => {
        const card = el('div', 'event-action-card');
        const top = el('div', 'event-action-heading');
        top.append(el('strong', '', 'Ação ' + (index + 1)));
        const remove = el('button', 'icon-button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remover ação');
        remove.addEventListener('click', () => onEventSave?.(node.id, actions.filter((_, i) => i !== index)));
        top.append(remove); card.append(top);
        const typeWrap = el('label', 'property-field'); typeWrap.append(el('span', '', 'Ação'));
        const typeSelect = el('select');
        actionTypes.forEach(item => { const option = el('option', '', item.label); option.value = item.value; typeSelect.append(option); });
        typeSelect.value = action.type || 'setText';
        typeSelect.addEventListener('change', () => onEventSave?.(node.id, actions.map((item, i) => i === index ? { type: typeSelect.value, targetId: item.targetId || '', value: item.value || '' } : item)));
        typeWrap.append(typeSelect); card.append(typeWrap);
        if (action.type !== 'log') card.append(targetSelect(action, index));
        if (action.type === 'setText' || !action.type || action.type === 'log' || action.type === 'setProperty') {
          const label = el('label', 'property-field');
          label.append(el('span', '', action.type === 'log' ? 'Mensagem' : action.type === 'setProperty' ? 'Valor da propriedade' : 'Novo texto'));
          const input = el('input'); input.type = 'text'; input.value = String(action.value ?? '');
          input.addEventListener('change', () => onEventSave?.(node.id, actions.map((item, i) => i === index ? { ...item, value: input.value } : item)));
          label.append(input); card.append(label);
        }
        if (action.type === 'setProperty') {
          const label = el('label', 'property-field'); label.append(el('span', '', 'Propriedade'));
          const select = el('select');
          [['background','Cor de fundo'],['color','Cor do texto'],['opacity','Opacidade'],['visible','Visibilidade']].forEach(([value,text]) => { const option=el('option','',text);option.value=value;select.append(option); });
          select.value = action.property || 'background';
          select.addEventListener('change', () => onEventSave?.(node.id, actions.map((item,i)=>i===index?{...item,property:select.value}:item)));
          label.append(select); card.append(label);
        }
        logic.append(card);
      });
      const add = el('button', 'button subtle', 'Adicionar ação');
      add.type = 'button'; add.addEventListener('click', () => onEventSave?.(node.id, [...actions, { type: 'setText', targetId: '', value: 'Olá!' }]));
      const removeEvent = el('button', 'button subtle danger-text', 'Excluir evento');
      removeEvent.type = 'button'; removeEvent.addEventListener('click', () => onEventSave?.(node.id, null));
      logic.append(add, removeEvent);
    }
    container.append(logic);
  }
  container.scrollTop = previousScrollTop;
}
