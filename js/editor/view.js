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

export function renderScene(container, scene, { selectedId = null, preview = false, assets = [], onRun = () => {}, sceneSize = { width: 960, height: 640 } } = {}) {
  for (const url of container._objectUrls || []) URL.revokeObjectURL(url);
  container._objectUrls = [];
  container.replaceChildren();
  const rootWidth = container.clientWidth || Math.max(1, Number(sceneSize.width) || 960);
  const rootHeight = container.clientHeight || Math.max(1, Number(sceneSize.height) || 640);
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));
  const measureLayout = (node, parentWidth, parentHeight) => {
    const layout = measureLayout(node, parentWidth, parentHeight);
    const automatic = node.props.automaticSize || 'None';
    if (automatic === 'None' || !node.children.length) return layout;
    for (let pass = 0; pass < 4; pass++) {
      let contentWidth = 0;
      let contentHeight = 0;
      for (const childId of node.children) {
        const child = scene.get(childId);
        if (!child) continue;
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
    if (!node || node.props.visible === false) return;
    const p = node.props;
    const item = el(node.type === 'TextButton' && preview ? 'button' : 'div', 'scene-node scene-' + node.type.toLowerCase());
    item.dataset.nodeId = node.id;
    const layout = resolveNodeLayout(node, parentWidth, parentHeight);
    item.style.left = (layout.x + layout.width * p.anchorPoint.x) + 'px';
    item.style.top = (layout.y + layout.height * p.anchorPoint.y) + 'px';
    item.style.width = layout.width + 'px';
    item.style.height = layout.height + 'px';
    item.style.transform = 'translate(' + (-p.anchorPoint.x * 100) + '%,' + (-p.anchorPoint.y * 100) + '%) rotate(' + (Number(p.rotation) || 0) + 'deg)';
    const isFrame = node.type === 'Frame';
    item.style.background = isFrame
      ? (p.backgroundColor3 || p.background || 'transparent')
      : (p.background || 'transparent');
    if (isFrame) {
      const bg = String(p.backgroundColor3 || p.background || 'transparent');
      const alpha = 1 - Math.max(0, Math.min(1, Number(p.backgroundTransparency) || 0));
      const match = bg.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (match) {
        const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
        item.style.backgroundColor = 'rgba(' + [0,2,4].map(index => parseInt(hex.slice(index,index+2),16)).join(',') + ',' + alpha + ')';
      }
      item.style.overflow = p.clipsDescendants ? 'hidden' : 'visible';
      item.style.zIndex = String(Math.max(1, Math.min(10, Number(p.zIndex) || 1)));
      const borderSize = Math.max(0, Math.min(20, Number(p.borderSizePixel) || 0));
      const borderColor = p.borderColor3 || p.border || 'transparent';
      item.style.border = p.borderMode === 'Middle' && borderSize ? borderSize + 'px solid ' + borderColor : '0';
      item.style.outline = p.borderMode === 'Outline' && borderSize ? borderSize + 'px solid ' + borderColor : 'none';
      item.style.outlineOffset = p.borderMode === 'Outline' ? '0' : '';
      item.style.boxShadow = p.borderMode === 'Inset' && borderSize ? 'inset 0 0 0 ' + borderSize + 'px ' + borderColor : 'none';
      if (p.style === 'DropShadow') item.style.boxShadow = '0 5px 14px rgba(0,0,0,.28)';
      if (p.style === 'ChatBlue') item.style.backgroundColor = 'rgba(36,84,135,' + alpha + ')';
      if (p.style === 'ChatGreen') item.style.backgroundColor = 'rgba(35,112,75,' + alpha + ')';
      if (p.style === 'ChatRed') item.style.backgroundColor = 'rgba(137,48,55,' + alpha + ')';
    } else {
      item.style.borderRadius = Math.max(0, Number(p.radius) || 0) + 'px';
      item.style.opacity = String(Math.max(0, Math.min(1, Number(p.opacity ?? 1))));
      item.style.border = Math.max(0, Number(p.borderWidth) || 0) + 'px solid ' + (p.border || 'transparent');
    }
    item.style.color = p.color || '#ffffff';
    item.style.fontSize = Math.max(8, Number(p.fontSize) || 16) + 'px';
    item.style.textAlign = p.textAlign || 'center';
    item.style.fontWeight = p.fontWeight || '500';
    item.textContent = node.type === 'Frame' ? '' : (p.text || (node.type === 'ImageLabel' ? '' : node.name));
    if (node.type === 'ImageLabel') {
      const asset = assetMap.get(p.assetId);
      if (asset?.blob) {
        const url = URL.createObjectURL(asset.blob);
        container._objectUrls.push(url);
        item.style.backgroundImage = 'url("' + url + '")';
        item.style.backgroundSize = p.fit || 'cover';
        item.style.backgroundPosition = 'center';
        item.dataset.objectUrl = url;
      }
      item.setAttribute('aria-label', node.name);
    }
    if (selectedId === node.id && !preview) item.classList.add('is-selected');
    if (preview && node.type === 'TextButton') item.addEventListener('click', event => { event.stopPropagation(); onRun(node, 'click'); });
    parent.append(item);
    for (const childId of node.children) build(childId, item, layout.width, layout.height);
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
  for (const id of scene.roots) build(id, container, rootWidth, rootHeight);
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

export function renderInspector(container, node, { onChange, onDelete, assets = [], onAsset, events = [], nodes = [], onEventSave } = {}) {
  const previousScrollTop = container.scrollTop;
  container.replaceChildren();
  if (!node) {
    container.append(el('p', 'inspector-empty', 'Selecione um objeto no palco ou na hierarquia para editar suas propriedades.'));
    return;
  }
  const heading = el('div', 'inspector-heading');
  heading.append(el('span', 'eyebrow', node.type.toUpperCase()), el('strong', '', node.name));
  container.append(heading);

  const readValue = key => key.split('.').reduce((value, part) => value?.[part], key === 'name' ? { name: node.name } : node.props);
  const field = descriptor => {
    const { key, label: labelText, type = 'number' } = descriptor;
    const wrap = el('label', 'property-field');
    wrap.append(el('span', '', labelText));
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
      input.type = type;
      if (type === 'number') {
        input.min = descriptor.min ?? '0';
        input.max = descriptor.max ?? '2000';
        input.step = descriptor.step ?? '1';
      }
    }
    const propertyValue = readValue(key);
    if (type === 'checkbox') input.checked = Boolean(propertyValue);
    else input.value = String(propertyValue ?? descriptor.fallback ?? '');
    input.addEventListener('change', () => {
      const value = type === 'number' ? Number(input.value) : type === 'checkbox' ? input.checked : input.value;
      if (type === 'asset') onAsset?.(value);
      else onChange(key, value);
    });
    wrap.append(input);
    return wrap;
  };

  const schema = getPropertySchema(node.type);
  schema.sections.forEach(definition => {
    const group = el('section', 'property-group');
    group.dataset.propertyCategory = definition.title;
    group.append(el('h3', '', definition.title));
    definition.fields.forEach(descriptor => group.append(field(descriptor)));
    container.append(group);
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
  const actions = el('div', 'inspector-actions');
  const remove = el('button', 'button danger', 'Excluir objeto');
  remove.type = 'button';
  remove.addEventListener('click', onDelete);
  actions.append(remove);
  container.append(actions);
  container.scrollTop = previousScrollTop;
}
