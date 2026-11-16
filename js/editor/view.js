const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderScene(container, scene, { selectedId = null, preview = false, assets = [], onRun = () => {} } = {}) {
  container.replaceChildren();
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));
  const build = (id, parent) => {
    const node = scene.get(id);
    if (!node || node.props.visible === false) return;
    const p = node.props;
    const item = el(node.type === 'TextButton' && preview ? 'button' : 'div', 'scene-node scene-' + node.type.toLowerCase());
    item.dataset.nodeId = node.id;
    item.style.left = (Number(p.x) || 0) + 'px';
    item.style.top = (Number(p.y) || 0) + 'px';
    item.style.width = Math.max(1, Number(p.width) || 1) + 'px';
    item.style.height = Math.max(1, Number(p.height) || 1) + 'px';
    item.style.background = p.background || 'transparent';
    item.style.color = p.color || '#ffffff';
    item.style.borderRadius = Math.max(0, Number(p.radius) || 0) + 'px';
    item.style.opacity = String(Math.max(0, Math.min(1, Number(p.opacity ?? 1))));
    item.style.border = Math.max(0, Number(p.borderWidth) || 0) + 'px solid ' + (p.border || 'transparent');
    item.style.fontSize = Math.max(8, Number(p.fontSize) || 16) + 'px';
    item.style.textAlign = p.textAlign || 'center';
    item.style.fontWeight = p.fontWeight || '500';
    item.textContent = node.type === 'Frame' ? '' : (p.text || (node.type === 'ImageLabel' ? '' : node.name));
    if (node.type === 'ImageLabel') {
      const asset = assetMap.get(p.assetId);
      if (asset?.blob) {
        const url = URL.createObjectURL(asset.blob);
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
    for (const childId of node.children) build(childId, item);
  };
  for (const id of scene.roots) build(id, container);
}

export function renderTree(container, scene, selectedId, onSelect) {
  container.replaceChildren();
  const list = el('div', 'tree-list');
  const add = (id, depth) => {
    const node = scene.get(id);
    if (!node) return;
    const row = el('button', 'tree-row' + (node.id === selectedId ? ' is-active' : ''));
    row.type = 'button';
    row.style.setProperty('--depth', depth);
    const marker = el('span', 'tree-marker', node.type === 'Frame' ? '▣' : node.type === 'TextButton' ? '▰' : node.type === 'ImageLabel' ? '▧' : 'T');
    const name = el('span', 'tree-name', node.name);
    const type = el('span', 'tree-type', node.type);
    row.append(marker, name, type);
    row.addEventListener('click', () => onSelect(node.id));
    list.append(row);
    node.children.forEach(childId => add(childId, depth + 1));
  };
  scene.roots.forEach(id => add(id, 0));
  if (!scene.roots.length) list.append(el('p', 'empty-inline', 'Seu projeto ainda não tem objetos.'));
  container.append(list);
}

export function renderInspector(container, node, { onChange, onDelete, assets = [], onAsset } = {}) {
  container.replaceChildren();
  if (!node) {
    container.append(el('p', 'inspector-empty', 'Selecione um objeto no palco ou na hierarquia para editar suas propriedades.'));
    return;
  }
  const heading = el('div', 'inspector-heading');
  heading.append(el('span', 'eyebrow', node.type.toUpperCase()), el('strong', '', node.name));
  container.append(heading);
  const field = (labelText, key, type = 'number', options = {}) => {
    const wrap = el('label', 'property-field');
    wrap.append(el('span', '', labelText));
    let input;
    if (type === 'select') {
      input = el('select');
      options.values.forEach(value => {
        const option = el('option', '', value.label);
        option.value = value.value;
        input.append(option);
      });
    } else {
      input = el('input');
      input.type = type;
      if (type === 'number') { input.min = options.min ?? '0'; input.max = options.max ?? '2000'; input.step = options.step ?? '1'; }
    }
    input.value = String(node.props[key] ?? options.fallback ?? '');
    input.addEventListener('change', () => {
      const value = type === 'number' ? Number(input.value) : type === 'checkbox' ? input.checked : input.value;
      onChange(key, value);
    });
    wrap.append(input);
    return wrap;
  };
  const section = (title, fields) => {
    const group = el('section', 'property-group');
    group.append(el('h3', '', title));
    fields.forEach(item => group.append(item));
    container.append(group);
  };
  section('Identificação', [field('Nome', 'name', 'text')]);
  section('Transformação', [
    field('Posição X', 'x'), field('Posição Y', 'y'),
    field('Largura', 'width', 'number', { min: 1, max: 2000 }),
    field('Altura', 'height', 'number', { min: 1, max: 2000 })
  ]);
  if (node.type !== 'ImageLabel') {
    section('Aparência', [
      field('Fundo', 'background', 'color'),
      ...(node.type !== 'Frame' ? [field('Cor do texto', 'color', 'color'), field('Texto', 'text', 'text'), field('Tamanho do texto', 'fontSize', 'number', { min: 8, max: 120 })] : []),
      field('Arredondamento', 'radius', 'number', { min: 0, max: 120 }),
      field('Opacidade', 'opacity', 'number', { min: 0, max: 1, step: 0.05 })
    ]);
  } else {
    const media = el('section', 'property-group');
    media.append(el('h3', '', 'Imagem'));
    const select = el('select');
    select.append(el('option', '', 'Nenhum arquivo'));
    select.options[0].value = '';
    for (const asset of assets.filter(item => item.mime?.startsWith('image/'))) {
      const option = el('option', '', asset.name);
      option.value = asset.id;
      select.append(option);
    }
    select.value = node.props.assetId || '';
    select.addEventListener('change', () => onAsset(select.value));
    media.append(el('label', 'property-field'), select);
    container.append(media);
    section('Aparência', [field('Ajuste', 'fit', 'select', { values: [{ value: 'cover', label: 'Preencher' }, { value: 'contain', label: 'Conter' }, { value: 'fill', label: 'Esticar' }] }), field('Arredondamento', 'radius', 'number', { min: 0, max: 120 })]);
  }
  const actions = el('div', 'inspector-actions');
  const remove = el('button', 'button danger', 'Excluir objeto');
  remove.type = 'button';
  remove.addEventListener('click', onDelete);
  actions.append(remove);
  container.append(actions);
}
