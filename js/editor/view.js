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

export function renderScene(container, scene, { selectedId = null, preview = false, assets = [], onRun = () => {} } = {}) {
  for (const url of container._objectUrls || []) URL.revokeObjectURL(url);
  container._objectUrls = [];
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
    item.style.transform = 'rotate(' + (Number(p.rotation) || 0) + 'deg)';
    item.style.border = Math.max(0, Number(p.borderWidth) || 0) + 'px solid ' + (p.border || 'transparent');
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
    for (const childId of node.children) build(childId, item);
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
    const marker = el('span', 'tree-marker'); marker.innerHTML = icon(node.type);
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

export function renderInspector(container, node, { onChange, onDelete, assets = [], onAsset, events = [], nodes = [], onEventSave } = {}) {
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
    if (type === 'checkbox') input.checked = Boolean(node.props[key]);
    else input.value = String(key === 'name' ? node.name : (node.props[key] ?? options.fallback ?? ''));
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
      field('Opacidade', 'opacity', 'number', { min: 0, max: 1, step: 0.05 }),
      field('Borda', 'border', 'color'), field('Espessura da borda', 'borderWidth', 'number', { min: 0, max: 30 }),
      field('Rotação', 'rotation', 'number', { min: -360, max: 360 }),
      field('Alinhamento do texto', 'textAlign', 'select', { values: [{value:'left',label:'Esquerda'},{value:'center',label:'Centro'},{value:'right',label:'Direita'}] }),
      field('Peso do texto', 'fontWeight', 'select', { values: [{value:'400',label:'Normal'},{value:'500',label:'Médio'},{value:'600',label:'Seminegrito'},{value:'700',label:'Negrito'}] }),
      field('Visível', 'visible', 'checkbox')
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
    const assetLabel = el('label', 'property-field');
    assetLabel.append(el('span', '', 'Arquivo da biblioteca'), select);
    media.append(assetLabel);
    container.append(media);
    section('Aparência', [field('Ajuste', 'fit', 'select', { values: [{ value: 'cover', label: 'Preencher' }, { value: 'contain', label: 'Conter' }, { value: 'fill', label: 'Esticar' }] }), field('Arredondamento', 'radius', 'number', { min: 0, max: 120 })]);
  }
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
}
