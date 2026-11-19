import { resolveNodeLayout, normalizeZIndex } from '../data/model.js';
import { getPropertySchema } from './property-schema.js';
const $ = id => document.getElementById(id);
const ICONS = {
  Frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/>',
  TextButton: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 12h8"/>',
  ImageButton: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/>',
  TextLabel: '<path d="M4 6h16M12 6v13M8 19h8"/>',
  ImageLabel: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/>',
  UIBackdrop: '<path d="M12 2.8C9.2 6.5 5.8 10 5.8 14.2a6.2 6.2 0 0 0 12.4 0C18.2 10 14.8 6.5 12 2.8Z"/><path d="M9.2 15.1a3 3 0 0 0 2.7 2.8"/>',
  Script: '<path d="m8 5-5 7 5 7M16 5l5 7-5 7M14 3l-4 18"/>',
};
const icon = type => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[type] || ICONS.Frame) + '</svg>';
const orderedSiblingIds = (scene, ids) => ids.map((id, index) => ({ id, index, node: scene.get(id) })).filter(item => item.node && item.node.type !== 'Script').sort((a, b) => normalizeZIndex(a.node.props.zIndex) - normalizeZIndex(b.node.props.zIndex) || a.index - b.index).map(item => item.id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const FONT_CSS = Object.freeze({
  Arial: 'Arial, Helvetica, sans-serif',
  Inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
  Roboto: 'Roboto, Arial, sans-serif',
  Georgia: 'Georgia, serif',
  Monospace: 'ui-monospace, SFMono-Regular, Consolas, monospace'
});

function richTextFragment(source) {
  const parsed = new DOMParser().parseFromString(String(source ?? ''), 'text/html');
  const fragment = document.createDocumentFragment();
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'FONT']);
  const copy = (parent, node) => {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.nodeValue || '')); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (!allowed.has(node.tagName)) { node.childNodes.forEach(child => copy(parent, child)); return; }
    const element = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === 'FONT') {
      const color = node.getAttribute('color') || '';
      const size = Number(node.getAttribute('size'));
      const face = node.getAttribute('face') || '';
      if (/^#[0-9a-f]{3,8}$/i.test(color)) element.style.color = color;
      if (Number.isFinite(size) && size >= 1 && size <= 100) element.style.fontSize = size + 'px';
      if (/^[a-z0-9 ,_-]{1,48}$/i.test(face)) element.style.fontFamily = face;
    }
    parent.append(element);
    node.childNodes.forEach(child => copy(element, child));
  };
  parsed.body.childNodes.forEach(node => copy(fragment, node));
  return fragment;
}

function fitTextSize(textValue, fontFamily, maxSize, width, height, lineHeight, wrap) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return maxSize;
  const lines = String(textValue || '').split('\n');
  const fits = size => {
    context.font = size + 'px ' + fontFamily;
    let count = 0, widest = 0;
    for (const raw of lines) {
      if (!wrap) { widest = Math.max(widest, context.measureText(raw).width); count++; continue; }
      let line = '';
      for (const word of raw.split(/\s+/)) {
        const next = line ? line + ' ' + word : word;
        if (line && context.measureText(next).width > width) { widest = Math.max(widest, context.measureText(line).width); count++; line = word; }
        else line = next;
      }
      widest = Math.max(widest, context.measureText(line).width);
      count++;
    }
    return widest <= width && count * size * lineHeight <= height;
  };
  let low = 1, high = Math.max(1, Math.min(100, maxSize));
  for (let step = 0; step < 9; step++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid; else high = mid;
  }
  return Math.max(1, Math.floor(low));
}


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
  const renderedNodeIds = new Set();
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
    if (!node || node.props.visible === false || node.type === 'UIBackdrop' || node.type === 'Script') return;
    const p = node.props;
    const existing = existingNodes.get(node.id);
    const isGuiButton = node.type === 'TextButton' || node.type === 'ImageButton';
    const elementTag = isGuiButton && preview ? 'button' : 'div';
    const item = existing && existing.tagName.toLowerCase() === elementTag ? existing : el(elementTag, 'scene-node scene-' + node.type.toLowerCase());
    item.className = 'scene-node scene-' + node.type.toLowerCase();
    item.dataset.nodeId = node.id;
    if (isGuiButton && preview) { item.type = 'button'; item.disabled = p.interactable === false; }
    renderedNodeIds.add(node.id);
    const layout = measureLayout(node, parentWidth, parentHeight);
    item.style.left = (layout.x + layout.width * p.anchorPoint.x) + 'px';
    item.style.top = (layout.y + layout.height * p.anchorPoint.y) + 'px';
    item.style.width = layout.width + 'px';
    item.style.height = layout.height + 'px';
    item.style.zIndex = String(normalizeZIndex(p.zIndex));
    item.style.transform = 'translate(' + (-p.anchorPoint.x * 100) + '%,' + (-p.anchorPoint.y * 100) + '%) rotate(' + (Number(p.rotation) || 0) + 'deg)';
    const isFrame = node.type === 'Frame';
    const backdropNode = isFrame ? node.children.map(childId => scene.get(childId)).find(child => child?.type === 'UIBackdrop') : null;
      item.style.background = isFrame ? 'transparent' : (p.backgroundColor3 || p.background || 'transparent');
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
      item.style.border = '0';
      item.style.outline = 'none';
      const frameRadius = Math.max(0, Math.min(400, Number(p.radius) || 0));
      item.style.borderRadius = frameRadius + 'px';
      item.style.backgroundColor = fillColor;
      item.style.backgroundImage = 'none';
      item.style.boxShadow = p.style === 'DropShadow' ? '0 5px 14px rgba(0,0,0,.28)' : 'none';
      const backdrop = backdropNode?.props || {};
      const effectEnabled = Boolean(backdrop.enabled) && backdropNode?.props.visible !== false;
      const backdropVisible = effectEnabled && alpha < 1;
      const blur = Math.max(0, Math.min(64, Number(backdrop.blur) || 0));
      const saturation = Math.max(0, Math.min(2.5, Number(backdrop.saturation ?? 1.2)));
      const brightness = Math.max(0.5, Math.min(1.5, Number(backdrop.brightness ?? 1.08)));
      const contrast = Math.max(0.5, Math.min(1.5, Number(backdrop.contrast ?? 1.08)));
      const tint = String(backdrop.tintColor || '#dbeafe');
      const tintMatch = tint.match(/^#([0-9a-f]{6})$/i);
      const tintHex = tintMatch ? tintMatch[1] : 'dbeafe';
      const tintRgb = [0,2,4].map(index => parseInt(tintHex.slice(index,index+2),16)).join(',');
      const tintAlpha = Math.max(0, Math.min(0.5, Number(backdrop.tintOpacity) || 0));
      const filter = 'blur(' + blur + 'px) saturate(' + saturation + ') brightness(' + brightness + ') contrast(' + contrast + ')';
      item.style.backdropFilter = backdropVisible ? filter : 'none';
      item.style.webkitBackdropFilter = item.style.backdropFilter;
      item.style.backgroundImage = backdropVisible && tintAlpha > 0
        ? 'linear-gradient(rgba(' + tintRgb + ',' + tintAlpha + '),rgba(' + tintRgb + ',' + tintAlpha + '))'
        : 'none';
      item.onpointermove = null;
      item.onpointerleave = null;
      item.style.boxShadow = 'none';
    } else {
      item.style.borderRadius = ['TextButton', 'ImageButton', 'TextLabel', 'ImageLabel'].includes(node.type) ? '0' : Math.max(0, Number(p.radius) || 0) + 'px';
      item.style.border = Math.max(0, Number(p.borderSizePixel ?? p.borderWidth) || 0) + 'px solid ' + (p.borderColor3 || p.border || 'transparent');
      if (node.type === 'TextButton' || node.type === 'TextLabel' || node.type === 'ImageLabel' || node.type === 'ImageButton') {
        const bg = String(p.backgroundColor3 || p.background || 'transparent');
        const alpha = 1 - Math.max(0, Math.min(1, Number(p.backgroundTransparency) || 0));
        const match = bg.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (match) {
          const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
          item.style.backgroundColor = 'rgba(' + [0,2,4].map(index => parseInt(hex.slice(index,index+2),16)).join(',') + ',' + alpha + ')';
        } else item.style.backgroundColor = bg;
      }
    }
    item.style.color = p.color || '#ffffff';
    item.style.fontSize = Math.max(8, Number(p.fontSize) || 16) + 'px';
    item.style.textAlign = p.textAlign || 'center';
    item.style.fontWeight = p.fontWeight || '500';
    const existingChildContainer = item.querySelector(':scope > .scene-children');
    const isImageNode = node.type === 'ImageLabel' || node.type === 'ImageButton';
    const preservedImageLayer = isImageNode ? item.querySelector(':scope > .scene-image-layer') : null;
    if (node.type === 'TextLabel' || node.type === 'TextButton') item.replaceChildren();
    else if (!isImageNode) item.textContent = node.type === 'Frame' ? '' : (p.text || node.name);
    const childContainer = existingChildContainer || el('div', 'scene-children');
    childContainer.replaceChildren();
    childContainer.style.position = 'absolute';
    childContainer.style.inset = '0';
    childContainer.style.overflow = node.type === 'Frame' && p.clipsDescendants ? 'hidden' : 'visible';
    if (isImageNode) childContainer.style.borderRadius = 'inherit';
    childContainer.style.zIndex = '2';
    for (const child of Array.from(item.children)) if (child !== childContainer && child !== preservedImageLayer && !(node.type === 'TextLabel' && child.classList.contains('scene-text-content'))) child.remove();
    if (node.type === 'TextLabel' || node.type === 'TextButton') {
      const content = el('span', 'scene-text-content');
      const fontKey = p.fontFace || 'Arial';
      const fontFamily = FONT_CSS[fontKey] || FONT_CSS.Arial;
      const weight = [400, 500, 600, 700].includes(Number(p.fontWeight)) ? Number(p.fontWeight) : 400;
      const textValue = String(p.text ?? '');
      const wrapped = Boolean(p.textWrapped || p.textScaled);
      const horizontal = p.textXAlignment || 'Center';
      const vertical = p.textYAlignment || 'Center';
      const fontSize = Math.max(1, Math.min(100, Number(p.textSize ?? p.fontSize ?? 14)));
      const paddingX = 18, paddingY = 10;
      const resolvedSize = p.textScaled
        ? fitTextSize(textValue, fontFamily, 100, Math.max(1, layout.width - paddingX), Math.max(1, layout.height - paddingY), Number(p.lineHeight) || 1, wrapped)
        : fontSize;
      if (p.richText) content.append(richTextFragment(textValue));
      else content.textContent = textValue;
      content.style.fontFamily = fontFamily;
      const featureText = String(p.openTypeFeatures || '').trim();
      if (/^[a-z0-9]{4}(?:\s+(?:on|off|[0-9]+))?(?:\s*,\s*[a-z0-9]{4}(?:\s+(?:on|off|[0-9]+))?)*$/i.test(featureText)) {
        content.style.fontFeatureSettings = featureText.split(',').map(entry => { const parts = entry.trim().split(/\s+/); return '\"' + parts[0] + '\"' + (parts[1] ? ' ' + (parts[1] === 'on' ? 1 : parts[1] === 'off' ? 0 : parts[1]) : ''); }).join(', ');
      }
      content.style.fontWeight = String(weight);
      content.style.fontSize = resolvedSize + 'px';
      content.style.lineHeight = String(Math.max(1, Math.min(3, Number(p.lineHeight) || 1)));
      content.style.color = p.textColor3 || p.color || '#000000';
      content.style.opacity = String(1 - Math.max(0, Math.min(1, Number(p.textTransparency) || 0)));
      content.style.textAlign = horizontal.toLowerCase();
      content.style.justifyContent = horizontal === 'Left' ? 'flex-start' : horizontal === 'Right' ? 'flex-end' : 'center';
      content.style.alignItems = vertical === 'Top' ? 'flex-start' : vertical === 'Bottom' ? 'flex-end' : 'center';
      content.style.whiteSpace = wrapped ? 'pre-wrap' : 'pre';
      content.style.overflowWrap = wrapped ? 'anywhere' : 'normal';
      content.style.direction = p.textDirection === 'RightToLeft' ? 'rtl' : p.textDirection === 'LeftToRight' ? 'ltr' : 'inherit';
      content.style.overflow = 'hidden';
      if (!wrapped) content.style.textOverflow = 'ellipsis';
      content.style.padding = '5px 9px';
      content.style.boxSizing = 'border-box';
      content.style.width = '100%';
      content.style.height = '100%';
      content.style.minWidth = '0';
      content.style.minHeight = '0';
      content.style.pointerEvents = 'none';
      item.append(content);
    }
    item.append(childContainer);
    if (isImageNode) {
      const asset = assetMap.get(p.assetId);
      const initialAsset = asset?.blob ? asset : node.type === 'ImageButton' ? assetMap.get(p.hoverAssetId) || assetMap.get(p.pressedAssetId) : null;
      if (initialAsset?.blob) {
        usedAssetIds.add(initialAsset.id);
        if (node.type === 'ImageButton') for (const variantId of [p.assetId, p.hoverAssetId, p.pressedAssetId]) if (variantId && assetMap.has(variantId)) usedAssetIds.add(variantId);
        let cached = assetUrls.get(initialAsset.id);
        if (!cached || cached.blob !== initialAsset.blob) {
          if (cached?.url) URL.revokeObjectURL(cached.url);
          cached = { blob: initialAsset.blob, url: URL.createObjectURL(initialAsset.blob) };
          assetUrls.set(initialAsset.id, cached);
        }
        const layer = preservedImageLayer || el('div', 'scene-image-layer');
        layer.replaceChildren();
        layer.style.position = 'absolute';
        layer.style.inset = '0';
        layer.style.overflow = 'hidden';
        layer.style.borderRadius = 'inherit';
        layer.style.pointerEvents = 'none';
        layer.style.zIndex = '0';
        // ImageTransparency belongs to the complete image composite, never to the background.
        const imageAlpha = 1 - Math.max(0, Math.min(1, Number(p.imageTransparency) || 0));
        layer.style.opacity = String(imageAlpha);
        layer.style.backgroundImage = 'none';
        layer.style.backgroundRepeat = 'no-repeat';
        layer.style.backgroundSize = '100% 100%';
        const image = el('img', 'scene-image-content');
        image.src = cached.url;
        image.alt = node.name;
        image.draggable = false;
        image.style.objectFit = p.fit === 'fill' ? 'fill' : p.fit === 'contain' ? 'contain' : p.fit === 'tile' ? 'none' : 'cover';
        image.style.zIndex = '0';
        const tint = el('div', 'scene-image-tint');
        tint.style.position = 'absolute';
        tint.style.inset = '0';
        tint.style.zIndex = '1';
        tint.style.pointerEvents = 'none';
        tint.style.backgroundColor = p.imageColor3 || '#ffffff';
        tint.style.mixBlendMode = 'multiply';
        tint.style.maskImage = 'url("' + cached.url + '")';
        tint.style.webkitMaskImage = tint.style.maskImage;
        if (p.fit === 'tile') {
          image.style.display = 'none';
          layer.style.backgroundImage = 'url("' + cached.url + '")';
          layer.style.backgroundRepeat = 'repeat';
          const tile = p.tileSize || {};
          const tileWidth = Math.max(1, Number(tile.x?.scale || 0) * layout.width + Number(tile.x?.offset || 64));
          const tileHeight = Math.max(1, Number(tile.y?.scale || 0) * layout.height + Number(tile.y?.offset || 64));
          layer.style.backgroundSize = tileWidth + 'px ' + tileHeight + 'px';
          tint.style.maskRepeat = 'repeat';
          tint.style.webkitMaskRepeat = 'repeat';
          tint.style.maskSize = tileWidth + 'px ' + tileHeight + 'px';
          tint.style.webkitMaskSize = tint.style.maskSize;
          tint.style.backgroundRepeat = 'repeat';
          tint.style.backgroundSize = tint.style.maskSize;
        } else {
          image.style.display = 'block';
          layer.style.backgroundImage = 'none';
          tint.style.maskRepeat = 'no-repeat';
          tint.style.webkitMaskRepeat = 'no-repeat';
          tint.style.maskSize = '100% 100%';
          tint.style.webkitMaskSize = '100% 100%';
          tint.style.backgroundRepeat = 'no-repeat';
          tint.style.backgroundSize = '100% 100%';
        }
        layer.append(image, tint);
        item.insertBefore(layer, childContainer);
        item.dataset.assetId = asset?.id || '';
        if (node.type === 'ImageButton') {
          const urlFor = assetId => {
            const record = assetMap.get(assetId);
            if (!record?.blob) return null;
            let entry = assetUrls.get(record.id);
            if (!entry || entry.blob !== record.blob) {
              if (entry?.url) URL.revokeObjectURL(entry.url);
              entry = { blob: record.blob, url: URL.createObjectURL(record.blob) };
              assetUrls.set(record.id, entry);
            }
            return entry.url;
          };
          const setImageState = assetId => {
            const url = urlFor(assetId || p.assetId);
            if (!url) { image.style.display = 'none'; layer.style.backgroundImage = 'none'; tint.style.maskImage = 'none'; tint.style.webkitMaskImage = 'none'; return; }
            image.style.display = p.fit === 'tile' ? 'none' : 'block'; image.src = url;
            tint.style.maskImage = 'url(\"' + url + '\")'; tint.style.webkitMaskImage = tint.style.maskImage;
            layer.style.backgroundImage = p.fit === 'tile' ? 'url(\"' + url + '\")' : 'none';
          };
          if (!asset?.blob) setImageState('');
          item.onpointerenter = preview ? () => setImageState(p.hoverAssetId || p.assetId) : null;
          item.onpointerleave = preview ? () => setImageState(p.assetId) : null;
          item.onpointerdown = preview ? () => setImageState(p.pressedAssetId || p.hoverAssetId || p.assetId) : null;
          item.onpointerup = preview ? () => setImageState(p.hoverAssetId || p.assetId) : null;
          item.onpointercancel = preview ? () => setImageState(p.assetId) : null;
        }
        if (!asset?.blob) { image.style.display = 'none'; layer.style.backgroundImage = 'none'; tint.style.maskImage = 'none'; tint.style.webkitMaskImage = 'none'; }
      } else {
        childContainer.style.backgroundImage = 'none';
        preservedImageLayer?.remove();
        delete item.dataset.assetId;
        delete item.dataset.imageUrl;
      }
      item.setAttribute('aria-label', node.name);
    }
    if (selectedId === node.id && !preview) item.classList.add('is-selected');
    if (preview && isGuiButton && p.autoButtonColor && !(node.type === 'ImageButton' && (p.hoverAssetId || p.pressedAssetId))) {
      item.onpointerenter = () => { item.style.filter = 'brightness(1.08)'; };
      item.onpointerdown = () => { item.style.filter = 'brightness(.92)'; };
      item.onpointerup = () => { item.style.filter = 'brightness(1.08)'; };
      item.onpointerleave = () => { item.style.filter = ''; };
    }
    item.onclick = preview && isGuiButton ? event => { event.stopPropagation(); onRun(node, 'click'); } : null;
    parent.append(item);
    for (const childId of orderedSiblingIds(scene, node.children)) build(childId, childContainer, layout.width, layout.height);
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
  for (const id of orderedSiblingIds(scene, scene.roots)) build(id, world, rootWidth, rootHeight);
  for (const [id, oldNode] of existingNodes) {
    if (!renderedNodeIds.has(id)) {
    }
  }
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

export function renderTree(container, scene, selectedId, { search = '', expanded = new Set(), onSelect = () => {}, onToggle = () => {}, onScriptEdit = () => {} } = {}) {
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
    const marker = el('span', 'tree-marker tree-icon-' + node.type.toLowerCase()); marker.innerHTML = icon(node.type);
    const name = el('span', 'tree-name', node.name);
    const type = el('span', 'tree-type', node.type);
    if (node.type === 'Script') {
      const openScript = el('button', 'tree-script-open', 'Abrir');
      openScript.type = 'button'; openScript.dataset.treeOpenScript = id;
      openScript.title = 'Abrir script'; openScript.setAttribute('aria-label', 'Abrir script ' + node.name);
      openScript.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8M8 9h8M8 13h5M6 3h12a1 1 0 0 1 1 1v16l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';
      row.append(toggle, marker, name, type, openScript);
    } else {
      const menu = el('button', 'tree-menu-trigger', '⋯'); menu.type = 'button'; menu.dataset.treeMenu = id;
      menu.setAttribute('aria-label', 'Opções de ' + node.name);
      row.append(toggle, marker, name, type, menu);
    }
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

export function renderInspector(container, node, { onChange, onDelete, onDuplicate, onEditStart, onPreview, onCommit, assets = [], onAsset, scripts = [], onScriptEdit, onSelectInstance, relatedInstances = [], parentInstance = null } = {}) {
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
  const instanceBar = el('div', 'inspector-instance-bar');
  if (node.type === 'UIBackdrop' && parentInstance) {
    const back = el('button', 'inspector-instance-chip is-parent', '← ' + parentInstance.name);
    back.type = 'button'; back.addEventListener('click', () => onSelectInstance?.(parentInstance.id));
    instanceBar.append(el('span', 'inspector-instance-label', 'Objeto principal'), back);
  } else if (relatedInstances.length) {
    instanceBar.append(el('span', 'inspector-instance-label', 'Subinstâncias'));
    relatedInstances.forEach(instance => {
      const chip = el('button', 'inspector-instance-chip');
      chip.type = 'button'; chip.innerHTML = icon(instance.type) + '<span>' + instance.name + '</span>';
      chip.title = 'Abrir propriedades de ' + instance.name;
      chip.addEventListener('click', () => onSelectInstance?.(instance.id));
      instanceBar.append(chip);
    });
  }
  if (instanceBar.childElementCount) container.append(instanceBar);
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
    const propertyValue = readValue(key);
    let input;
    if (type === 'asset') {
      input = el('button', 'asset-picker-trigger');
      input.type = 'button';
      const selectedAsset = assets.find(asset => asset.id === propertyValue);
      input.textContent = selectedAsset?.name || 'Escolher imagem…';
      input.dataset.openAssetPicker = 'true';
      input.dataset.assetProperty = key;
      input.setAttribute('aria-label', 'Escolher imagem da Biblioteca: ' + labelText);
    } else if (type === 'select') {
      input = el('select');
      (descriptor.values || []).forEach(value => {
        const option = el('option', '', value.label);
        option.value = value.value;
        input.append(option);
      });
    } else {
      input = type === 'textarea' ? el('textarea') : el('input');
      if (type === 'textarea') { input.rows = 3; input.classList.add('property-textarea'); }
      else input.type = type === 'slider' ? 'range' : type;
      if (type === 'number' || type === 'slider') {
        input.min = descriptor.min ?? '0';
        input.max = descriptor.max ?? '2000';
        input.step = descriptor.step ?? '1';
      }
    }
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
        const parts = raw.trim().split(/[;,\s]+/).filter(Boolean);
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
    } else if (type === 'asset') {
      wrap.append(input);
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
      if (descriptor.visibleWhen) control.hidden = node.props[descriptor.visibleWhen.key] !== descriptor.visibleWhen.value;
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

  if (node.type === 'Script') {
    const scriptPanel = el('section', 'property-group script-group');
    scriptPanel.append(el('h3', '', 'Código'));
    scriptPanel.append(el('p', 'event-editor-note', node.props.source?.trim() ? 'FlowScript independente. O evento é conectado ao botão pelo nome.' : 'Este Script ainda não possui código.'));
    const edit = el('button', 'button subtle script-edit-button', 'Editar código');
    edit.type = 'button';
    edit.addEventListener('click', () => onScriptEdit?.(node.id));
    scriptPanel.append(edit);
    container.append(scriptPanel);
  }
  container.scrollTop = previousScrollTop;
}
