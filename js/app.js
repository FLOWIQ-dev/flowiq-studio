import { Store } from './core/store.js';
import { History } from './core/history.js';
import { Scene, COMPONENTS, resolveNodeLayout } from './data/model.js';
import { Database } from './data/database.js';
import { renderScene, renderTree, renderInspector, updateSceneLayout } from './editor/view.js';
import { Runtime } from './runtime/runtime.js';

const $ = id => document.getElementById(id);
const makeId = () => crypto.randomUUID?.() || 'flowiq_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

class FlowiqStudio {
  constructor() {
    this.db = new Database();
    this.screenTransition = 0;
    this.store = new Store({ screen: 'home', project: null, selectedId: null, panel: 'explorer', busy: false });
    this.scene = new Scene();
    this.history = new History({ onChange: status => this.updateHistory(status) });
    this.runtime = new Runtime({ onLog: (message, type) => this.log(message, type) });
    this.assets = [];
    this.saveTimer = 0;
    this.savePromise = null;
    this.savePending = false;
    this.drag = null;
    this.cameraOffset = { x: 0, y: 0 };
    this.cameraTracking = false;
    this.cameraTrackingId = null;
    this.cameraEscaped = false;
    this.inspectorCameraSnapshot = null;
    this.cameraTrackFrame = 0;
    this.previewScene = null;
    this.dialogResolve = null;
    this.search = '';
    this.treeSearch = '';
    this.treeExpanded = new Set();
    this.treeDrag = null;
    this.treeMoveMode = null;
    this.treeHoldTimer = null;
    this.treeTouch = null;
    this.treeDragGhost = null;
    this.treeAutoScrollFrame = 0;
    this.addParentId = null;
    this.guarded = task => (...args) => Promise.resolve(task(...args)).catch(error => this.toast(error.message || 'Ocorreu um erro inesperado.', 'error'));
    this.returnScreen = 'home';
    this.bind();
    this.start();
  }

  async start() {
    try {
      await this.db.open();
      await this.refreshProjects();
      this.assets = await this.db.listAssets();
      this.showScreen('home');
    } catch (error) {
      this.toast(error.message, 'error');
      this.showScreen('home');
      $('project-list').replaceChildren(this.empty('Não foi possível iniciar o armazenamento local.'));
    }
  }

  bind() {
    const guarded = this.guarded;
    $('create-project').addEventListener('click', guarded(() => this.createProject()));
    $('project-search').addEventListener('input', event => { this.search = event.target.value.trim().toLocaleLowerCase('pt-BR'); this.renderProjects(); });
    $('home-library').addEventListener('click', guarded(() => this.openLibrary()));
    $('editor-library').addEventListener('click', guarded(() => this.openLibrary()));
    $('home-settings').addEventListener('click', guarded(() => this.openSettings()));
    $('back-home').addEventListener('click', guarded(() => this.returnHome()));
    $('editor-shell').addEventListener('click', event => { if (event.target === $('editor-shell') && window.matchMedia('(max-width: 680px)').matches && $('editor-shell').dataset.panel !== 'stage') this.setPanel('stage'); });
    $('close-add-menu').addEventListener('click', () => this.closeAddMenu());
    $('object-search').addEventListener('input', event => this.filterAddMenu(event.target.value));
    $('add-menu').addEventListener('click', event => {
      const button = event.target.closest('[data-add-type]');
      if (button) this.addNode(button.dataset.addType);
    });
    $('tree-search').addEventListener('input', event => { this.treeSearch = event.target.value; this.renderTreePanel(); });
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-tree-action]');
      if (action) { this.handleTreeAction(action.dataset.treeAction, action.dataset.nodeId); return; }
      if (event.target.closest('[data-tree-move-cancel]')) this.cancelTreeMoveMode();
    });
    $('tree').addEventListener('click', event => {
      const toggle = event.target.closest('[data-tree-toggle]');
      if (toggle) { this.toggleTreeNode(toggle.dataset.treeToggle); return; }
      const menu = event.target.closest('[data-tree-menu]');
      if (menu) { this.openTreeMenu(menu.dataset.treeMenu, menu); return; }
      const row = event.target.closest('[data-tree-node]');
      if (row && !event.target.closest('button')) {
        if (this.treeMoveMode) this.finishTreeMoveInside(row.dataset.treeNode);
        else this.select(row.dataset.treeNode);
      }
      const action = event.target.closest('[data-tree-action]');
      if (action) this.handleTreeAction(action.dataset.treeAction, action.dataset.nodeId);
    });
    $('tree').addEventListener('contextmenu', event => { event.preventDefault(); });
    $('add-menu-backdrop').addEventListener('click', () => this.closeAddMenu());
    $('scene').addEventListener('pointerdown', event => this.pointerDown(event));
    window.addEventListener('pointerup', event => this.finishSceneTap(event));
    window.addEventListener('pointercancel', event => { if (this.sceneTap?.pointerId === event.pointerId) this.sceneTap = null; });
    $('scene').addEventListener('click', event => {
      if (event.target === $('scene') && this.store.state.selectedId) this.select(null);
    });
    $('scene').addEventListener('dblclick', event => {
      const target = event.target.closest('.scene-node');
      if (!target || this.runtime.running) return;
      event.preventDefault();
      this.select(target.dataset.nodeId);
      this.setPanel('inspector');
    });
    $('inspector').addEventListener('change', event => {
      const input = event.target.closest('[data-property]');
      if (!input) return;
      const key = input.dataset.property;
      const value = input.type === 'number' ? Number(input.value) : input.value;
      this.updateProperty(key, value);
    });
    $('inspector').addEventListener('click', event => {
      const asset = event.target.closest('[data-asset-picker]');
      if (asset) $('image-picker').click();
    });
    $('image-picker').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const record = await this.db.saveAsset({ id: makeId(), name: file.name, blob: file });
        this.assets = await this.db.listAssets();
        this.updateProperty('assetId', record.id);
      } catch (error) { this.toast(error.message, 'error'); }
      event.target.value = '';
    });
    $('undo').addEventListener('click', () => this.undo());
    $('redo').addEventListener('click', () => this.redo());
    $('preview').addEventListener('click', () => this.play());
    $('stop-preview').addEventListener('click', () => this.stopPreview());
    $('zoom-in').addEventListener('click', () => this.setZoom(this.zoom + 0.1));
    $('zoom-out').addEventListener('click', () => this.setZoom(this.zoom - 0.1));
    $('zoom-fit').addEventListener('click', () => this.fitStage(true));
    $('camera-reset').addEventListener('click', () => this.resetCamera());
    $('save-project').addEventListener('click', () => this.saveProject().catch(() => {}));
    $('add-assets').addEventListener('click', () => $('asset-upload').click());
    $('asset-upload').addEventListener('change', guarded(event => this.uploadAssets(event.target.files)));
    $('asset-list').addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-asset]');
      if (remove) guarded(() => this.removeAsset(remove.dataset.removeAsset))();
    });
    $('export-backup').addEventListener('click', () => this.exportBackup());
    $('import-backup').addEventListener('click', () => $('backup-input').click());
    $('backup-input').addEventListener('change', event => this.importBackup(event.target.files?.[0]));
    $('settings-back').addEventListener('click', guarded(() => this.returnHome()));
    $('library-back').addEventListener('click', guarded(() => this.returnHome()));
    $('mobile-add-objects').addEventListener('click', () => this.toggleAddMenu());
    $('mobile-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-panel]');
      if (button) this.setPanel(button.dataset.panel);
    });
    $('panel-close').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.setPanel('stage');
    });
    $('explorer-close').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.setPanel('stage');
    });
    $('dialog').addEventListener('click', event => { if (event.target === $('dialog')) this.resolveDialog(null); });
    document.addEventListener('keydown', event => this.keydown(event));
    window.addEventListener('beforeunload', event => {
      if (this.store.state.project && this.dirty) { event.preventDefault(); event.returnValue = ''; }
    });
    const stageHost = $('stage-viewport');
    if (stageHost && 'ResizeObserver' in window) {
      this.stageResizeObserver = new ResizeObserver(() => this.fitStage());
      this.stageResizeObserver.observe(stageHost);
    }
    window.addEventListener('resize', () => this.fitStage(), { passive: true });
    window.addEventListener('resize', () => this.fitPreview(), { passive: true });
    window.visualViewport?.addEventListener('resize', () => this.fitStage(), { passive: true });
  }

  get zoom() { return this._zoom || 1; }
  set zoom(value) { this._zoom = Math.max(0.25, Math.min(2.5, value)); }

  showScreen(screen) {
    const names = ['home', 'editor', 'library', 'settings'];
    const next = $('screen-' + screen);
    if (!next) return;
    const token = ++this.screenTransition;
    const current = names.map(name => $('screen-' + name)).find(element => element && !element.hidden && element !== next);
    this.store.set({ screen });
    document.documentElement.dataset.screen = screen;
    document.body.dataset.screen = screen;
    next.hidden = false;
    next.classList.remove('screen-entering');
    requestAnimationFrame(() => {
      if (token !== this.screenTransition) return;
      next.classList.add('screen-visible');
      if (current) current.classList.remove('screen-visible');
    });
    const finish = () => {
      if (token !== this.screenTransition) return;
      for (const name of names) {
        const element = $('screen-' + name);
        if (element !== next) { element.hidden = true; element.classList.remove('screen-visible'); }
      }
    };
    if (current) {
      current.addEventListener('transitionend', event => { if (event.target === current && event.propertyName === 'opacity') finish(); }, { once: true });
      setTimeout(finish, 280);
    } else {
      for (const name of names) if ($('screen-' + name) !== next) $('screen-' + name).hidden = true;
    }
    if (screen === 'editor') requestAnimationFrame(() => this.fitStage());
  }

  async refreshProjects() {
    this.projects = await this.db.listProjects();
    this.renderProjects();
    $('project-count').textContent = this.projects.length + (this.projects.length === 1 ? ' projeto' : ' projetos');
  }

  renderProjects() {
    const root = $('project-list');
    root.replaceChildren();
    const items = (this.projects || []).filter(project => project.name.toLocaleLowerCase('pt-BR').includes(this.search));
    if (!items.length) {
      root.append(this.empty(this.search ? 'Nenhum projeto corresponde à busca.' : 'Ainda não há projetos. Crie o primeiro para começar.'));
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'project-grid';
    for (const project of items) {
      const card = document.createElement('article');
      card.className = 'project-card';
      const preview = document.createElement('div');
      preview.className = 'project-card-preview';
      preview.innerHTML = '<span class="preview-grid"></span><span class="preview-frame"></span><span class="preview-label"></span>';
      const body = document.createElement('div');
      body.className = 'project-card-body';
      const name = document.createElement('strong');
      name.textContent = project.name;
      const meta = document.createElement('small');
      meta.textContent = new Date(project.updatedAt || project.createdAt).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
      const actions = document.createElement('div');
      actions.className = 'project-card-actions';
      const open = this.button('Abrir', 'button primary');
      open.addEventListener('click', () => this.openProject(project.id));
      const rename = this.button('', 'icon-button project-icon-action');
      rename.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/></svg>';
      rename.setAttribute('aria-label', 'Renomear projeto'); rename.title = 'Renomear projeto';
      rename.addEventListener('click', this.guarded(() => this.renameProject(project)));
      const remove = this.button('', 'icon-button project-icon-action danger-text');
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg>';
      remove.setAttribute('aria-label', 'Excluir projeto'); remove.title = 'Excluir projeto';
      remove.addEventListener('click', this.guarded(() => this.deleteProject(project)));
      actions.append(open, rename, remove);
      body.append(name, meta, actions);
      card.append(preview, body);
      grid.append(card);
    }
    root.append(grid);
  }

  async createProject() {
    const name = await this.dialog({ title: 'Novo projeto', label: 'Nome do projeto', value: 'Meu projeto', confirm: 'Criar' });
    if (!name) return;
    const now = new Date().toISOString();
    const project = { id: makeId(), name: name.trim().slice(0, 64), scene: [], events: [], scripts: [], animations: [], settings: { width: 960, height: 640 }, createdAt: now, updatedAt: now };
    await this.db.saveProject(project);
    await this.openProject(project.id);
  }

  async renameProject(project) {
    const name = await this.dialog({ title: 'Renomear projeto', label: 'Nome', value: project.name, confirm: 'Salvar' });
    if (!name || name.trim() === project.name) return;
    project.name = name.trim().slice(0, 64);
    await this.db.saveProject(project);
    await this.refreshProjects();
  }

  async deleteProject(project) {
    const yes = await this.confirm('Excluir projeto?', '“' + project.name + '” será removido deste dispositivo.');
    if (!yes) return;
    await this.db.deleteProject(project.id);
    await this.refreshProjects();
    this.toast('Projeto excluído.');
  }

  async openProject(id) {
    this.store.set({ busy: true });
    try {
      const project = await this.db.getProject(id);
      if (!project) throw new Error('O projeto não foi encontrado.');
      this.project = project;
      const storedScene = project.scene || [];
      const needsLayoutMigration = storedScene.some(function hasLegacyLayout(item) {
        return !item?.props?.position || !item?.props?.size || (item.children || []).some(hasLegacyLayout);
      });
      this.scene = new Scene(storedScene);
      if (needsLayoutMigration) this.project.scene = this.scene.toJSON();
      this.store.set({ project, selectedId: null, screen: 'editor', panel: 'stage' });
      this.setPanel('stage');
      this.history.clear();
      this.dirty = false;
      $('project-name').textContent = project.name;
      $('scene-size').textContent = (project.settings?.width || 960) + ' × ' + (project.settings?.height || 640);
      $('mobile-tabs').hidden = false;
      this.renderEditor();
      this.showScreen('editor');
      if (needsLayoutMigration) {
        this.scheduleSave();
        this.log('Layout antigo convertido para Position e Size compatíveis com UDim2.', 'success');
      }
      this.log('Projeto aberto.', 'success');
    } catch (error) {
      this.toast(error.message, 'error');
    } finally { this.store.set({ busy: false }); }
  }

  async returnHome() {
    if (['library', 'settings'].includes(this.store.state.screen) && this.returnScreen === 'editor') { this.showScreen('editor'); this.renderEditor(); return; }
    if (this.store.state.screen === 'editor' && this.dirty) {
      const choice = await this.dialog({ title: 'Salvar alterações?', message: 'Existem mudanças neste projeto.', choices: [{ value: 'save', label: 'Salvar e sair' }, { value: 'discard', label: 'Sair sem salvar' }, { value: 'cancel', label: 'Continuar editando' }] });
      if (choice === 'cancel' || !choice) return;
      if (choice === 'save') { try { await this.saveProject(); } catch { return; } }
    }
    this.stopPreview(false);
    this.project = null;
    this.scene = new Scene();
    this.store.set({ project: null, selectedId: null });
    await this.refreshProjects();
    this.showScreen('home');
  }

  async saveProject() {
    if (!this.project) return;
    clearTimeout(this.saveTimer);
    if (this.savePromise) { this.savePending = true; return this.savePromise; }
    this.savePromise = (async () => {
      do {
        this.savePending = false;
        this.project.scene = this.scene.toJSON();
        this.project.updatedAt = new Date().toISOString();
        const snapshot = JSON.parse(JSON.stringify(this.project));
        await this.db.saveProject(snapshot);
        await this.refreshProjects();
      } while (this.savePending);
      this.dirty = false;
      $('save-state').textContent = 'Salvo';
      $('save-state').dataset.state = 'saved';
    })();
    try {
      await this.savePromise;
    } catch (error) {
      this.toast('Falha ao salvar: ' + error.message, 'error');
      throw error;
    } finally {
      this.savePromise = null;
    }
  }

  scheduleSave() {
    this.dirty = true;
    $('save-state').textContent = 'Alterações não salvas';
    $('save-state').dataset.state = 'dirty';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveProject().catch(() => {}), 450);
  }

  addNode(type, parentId = undefined) {
    if (!COMPONENTS.some(item => item.type === type)) return;
    this.history.checkpoint(this.historySnapshot());
    const destinationId = parentId !== undefined ? parentId : this.addParentId !== null ? this.addParentId : undefined;
    const parent = destinationId === undefined ? this.scene.get(this.store.state.selectedId) : this.scene.get(destinationId);
    const node = this.scene.create(type, parent?.id || null);
    this.select(node.id);
    this.closeAddMenu();
    this.scheduleSave();
    this.renderEditor();
  }

  select(id) {
    if (id && !this.scene.get(id)) return;
    if (id) { let parent = this.scene.get(id)?.parentId; while (parent) { this.treeExpanded.add(parent); parent = this.scene.get(parent)?.parentId; } }
    this.store.set({ selectedId: id });
    if (this.cameraTracking) this.cameraTrackingId = id;
    this.renderEditor();
    if (this.cameraTracking || this.inspectorCameraSnapshot) this.trackSelectedObject();
  }

  beginPropertyEdit(key) {
    if (this.activePropertyEdit?.key === key) return;
    this.activePropertyEdit = { key };
    this.history.checkpoint(this.historySnapshot());
  }

  previewProperty(key, value) {
    this.updateProperty(key, value, { checkpoint: false, render: false, save: false });
    const stageSize = this.getStageSize();
    renderScene($('scene'), this.scene, { selectedId: this.store.state.selectedId, assets: this.assets, sceneSize: stageSize, zoom: this.zoom, cameraOffset: this.cameraOffset });
    this.trackSelectedObject();
  }

  commitPropertyEdit(key, value) {
    if (this.activePropertyEdit?.key !== key) {
      this.updateProperty(key, value);
      return;
    }
    this.activePropertyEdit = null;
    this.updateProperty(key, value, { checkpoint: false, render: false, save: true });
    const stageSize = this.getStageSize();
    renderScene($('scene'), this.scene, { selectedId: this.store.state.selectedId, assets: this.assets, sceneSize: stageSize, zoom: this.zoom, cameraOffset: this.cameraOffset });
    this.trackSelectedObject();
  }

  updateProperty(key, value, { checkpoint = true, render = true, save = true } = {}) {
    const node = this.scene.get(this.store.state.selectedId);
    if (!node) return;
    if (checkpoint) this.history.checkpoint(this.historySnapshot());
    if (key === 'name') node.name = String(value).trim().slice(0, 64) || node.type;
    else if (['position', 'size'].includes(key) && value && typeof value === 'object') {
      const target = node.props[key];
      for (const axis of ['x', 'y']) {
        target[axis].scale = Math.max(key === 'size' ? 0 : -10, Math.min(10, Number(value[axis]?.scale) || 0));
        target[axis].offset = key === 'size'
          ? Math.max(1, Math.min(4000, Number(value[axis]?.offset) || 1))
          : Math.max(-4000, Math.min(4000, Number(value[axis]?.offset) || 0));
      }
      if (key === 'position') { node.props.x = target.x.offset; node.props.y = target.y.offset; }
      else { node.props.width = target.x.offset; node.props.height = target.y.offset; }
    } else if (key.includes('.')) {
      const parts = key.split('.');
      const leaf = parts.pop();
      let target = node.props;
      for (const part of parts) target = target[part];
      let next = Number(value);
      if (!Number.isFinite(next)) next = 0;
      if (parts[0] === 'position') next = Math.max(-4000, Math.min(4000, next));
      if (parts[0] === 'size') next = leaf === 'scale' ? Math.max(0, Math.min(10, next)) : Math.max(1, Math.min(4000, next));
      if (parts[0] === 'anchorPoint') next = Math.max(0, Math.min(1, next));
      target[leaf] = next;
      if (key === 'position.x.offset') node.props.x = next;
      if (key === 'position.y.offset') node.props.y = next;
      if (key === 'size.x.offset') node.props.width = next;
      if (key === 'size.y.offset') node.props.height = next;
    } else if (['x', 'y'].includes(key)) {
      const next = Math.max(-4000, Math.min(4000, Number(value) || 0));
      node.props[key] = next;
      node.props.position[key].offset = next;
    } else if (['width', 'height'].includes(key)) {
      const next = Math.max(1, Math.min(4000, Number(value) || 1));
      node.props[key] = next;
      node.props.size[key === 'width' ? 'x' : 'y'].offset = next;
    } else if (key === 'opacity' || key === 'backgroundTransparency') node.props[key] = Math.max(0, Math.min(1, Number(value) || 0));
    else if (key === 'radius') node.props[key] = Math.max(0, Math.min(160, Number(value) || 0));
    else node.props[key] = value;
    if (save) this.scheduleSave();
    if (render) {
      this.renderEditor();
      this.trackSelectedObject();
    }
  }

  saveButtonAction(nodeId, actions) {
    this.history.checkpoint(this.historySnapshot());
    const events = Array.isArray(this.project.events) ? [...this.project.events] : [];
    const index = events.findIndex(rule => rule && rule.nodeId === nodeId && rule.event === 'click');
    if (actions === null) {
      if (index >= 0) events.splice(index, 1);
    } else if (index >= 0) {
      events[index] = { ...events[index], actions: JSON.parse(JSON.stringify(actions)) };
    } else {
      events.push({ id: makeId(), nodeId, event: 'click', actions: JSON.parse(JSON.stringify(actions)) });
    }
    this.project.events = events.filter(Boolean);
    this.scheduleSave();
    this.renderInspectorPanel(this.scene.get(nodeId));
    this.toast('Interação atualizada.');
  }

  duplicateSelected() {
    const id = this.store.state.selectedId;
    if (!id) return;
    this.history.checkpoint(this.historySnapshot());
    const originals = this.scene.descendants(id);
    const copy = this.scene.duplicate(id);
    const duplicates = this.scene.descendants(copy.id);
    const remap = new Map(originals.map((node, index) => [node.id, duplicates[index]?.id]).filter(([, value]) => value));
    const clonedEvents = (this.project.events || []).filter(rule => rule && remap.has(rule.nodeId)).map(rule => ({
      ...JSON.parse(JSON.stringify(rule)),
      id: makeId(),
      nodeId: remap.get(rule.nodeId),
      actions: (Array.isArray(rule.actions) ? rule.actions : []).filter(Boolean).map(action => ({ ...action, targetId: remap.get(action.targetId) || action.targetId }))
    }));
    this.project.events = [...(this.project.events || []), ...clonedEvents];
    this.project.scripts = [...(this.project.scripts || []), ...(this.project.scripts || []).filter(item => item && remap.has(item.nodeId)).map(item => ({ ...JSON.parse(JSON.stringify(item)), id: makeId(), nodeId: remap.get(item.nodeId) }))];
    this.project.animations = [...(this.project.animations || []), ...(this.project.animations || []).filter(item => item && remap.has(item.nodeId)).map(item => ({ ...JSON.parse(JSON.stringify(item)), id: makeId(), nodeId: remap.get(item.nodeId) }))];
    this.select(copy.id);
    this.scheduleSave();
  }

  deleteSelected() {
    const id = this.store.state.selectedId;
    if (!id) return;
    this.history.checkpoint(this.historySnapshot());
    const removedIds = new Set(this.scene.descendants(id).map(node => node.id));
    this.scene.remove(id);
    this.project.events = (this.project.events || []).filter(rule => rule && !removedIds.has(rule.nodeId) && !(Array.isArray(rule.actions) ? rule.actions : []).some(action => action && removedIds.has(action.targetId)));
    this.project.scripts = (this.project.scripts || []).filter(item => item && !removedIds.has(item.nodeId));
    this.project.animations = (this.project.animations || []).filter(item => item && !removedIds.has(item.nodeId));
    this.store.set({ selectedId: null });
    this.scheduleSave();
    this.renderEditor();
  }

  historySnapshot() {
    return { scene: this.scene.snapshot(), events: this.project?.events || [], scripts: this.project?.scripts || [], animations: this.project?.animations || [] };
  }

  undo() {
    const snapshot = this.history.undo(this.historySnapshot());
    if (!snapshot) return;
    this.scene = new Scene(snapshot.scene);
    this.project.events = snapshot.events || [];
    this.project.scripts = snapshot.scripts || [];
    this.project.animations = snapshot.animations || [];
    this.scheduleSave();
    this.renderEditor();
  }

  redo() {
    const snapshot = this.history.redo(this.historySnapshot());
    if (!snapshot) return;
    this.scene = new Scene(snapshot.scene);
    this.project.events = snapshot.events || [];
    this.project.scripts = snapshot.scripts || [];
    this.project.animations = snapshot.animations || [];
    this.scheduleSave();
    this.renderEditor();
  }

  updateHistory(status) {
    $('undo').disabled = !status.canUndo;
    $('redo').disabled = !status.canRedo;
  }

  renderTreePanel() {
    const tree = $('tree');
    renderTree(tree, this.scene, this.store.state.selectedId, {
      search: this.treeSearch,
      expanded: this.treeExpanded,
      onSelect: id => this.select(id),
      onToggle: id => this.toggleTreeNode(id)
    });
    tree.classList.toggle('tree-move-mode-active', !!this.treeMoveMode);
    tree.querySelectorAll('[data-tree-node]').forEach(row => row.classList.toggle('tree-move-source', row.dataset.treeNode === this.treeMoveMode));
  }

  startTreeMoveMode(id) {
    if (!this.scene.get(id)) return;
    this.treeMoveMode = id;
    this.treeExpanded.add(id);
    this.renderTreePanel();
    this.toast('Mover: toque no objeto que receberá este item.');
  }

  cancelTreeMoveMode() {
    this.treeMoveMode = null; document.querySelector('.tree-context-menu')?.remove(); this.renderTreePanel();
  }

  finishTreeMoveInside(targetId) {
    const sourceId = this.treeMoveMode;
    const source = this.scene.get(sourceId), target = this.scene.get(targetId);
    if (!source || !target) { this.cancelTreeMoveMode(); return; }
    if (source.id === target.id || this.scene.descendants(sourceId).some(node => node.id === targetId)) {
      this.toast('Escolha outro objeto. Não é possível mover para dentro de si mesmo ou de um descendente.', 'error');
      return;
    }
    try {
      this.history.checkpoint(this.historySnapshot());
      this.scene.reparent(sourceId, targetId);
      this.treeExpanded.add(targetId);
      this.treeMoveMode = null;
      this.select(sourceId);
      this.scheduleSave();
      this.toast('Objeto movido para dentro de ' + target.name + '.');
    } catch (error) { this.toast(error.message, 'error'); }
  }

  toggleTreeNode(id) {
    if (this.treeExpanded.has(id)) this.treeExpanded.delete(id);
    else this.treeExpanded.add(id);
    this.renderTreePanel();
  }

  openTreeMenu(id, anchor) {
    const node = this.scene.get(id);
    if (!node) return;
    document.querySelector('.tree-context-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'tree-context-menu';
    const trackingLabel = this.cameraTracking && this.cameraTrackingId === id ? 'Parar rastreamento' : 'Rastrear câmera';
    for (const [action, label] of [['track-camera', trackingLabel], ['move', 'Mover'], ['rename', 'Renomear'], ['add', 'Adicionar instância'], ['duplicate', 'Duplicar'], ['delete', 'Excluir']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.treeAction = action;
      button.dataset.nodeId = id;
      if (action === 'delete') button.className = 'danger-text';
      menu.append(button);
    }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 190)) + 'px';
    menu.style.top = Math.min(window.innerHeight - 190, rect.bottom) + 'px';
    document.body.append(menu);
    const close = event => {
      if (!menu.contains(event.target)) { menu.remove(); document.removeEventListener('pointerdown', close, true); }
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }

  async handleTreeAction(action, id) {
    document.querySelector('.tree-context-menu')?.remove();
    const node = this.scene.get(id);
    if (!node) return;
    if (action === 'add') { this.openAddMenu(id); return; }
    if (action === 'track-camera') {
      const stop = this.cameraTracking && this.cameraTrackingId === id;
      this.select(id);
      this.cameraTracking = !stop;
      this.cameraTrackingId = stop ? null : id;
      if (this.cameraTracking) this.inspectorCameraSnapshot = null;
      $('scene').classList.toggle('is-camera-tracking', this.cameraTracking || Boolean(this.inspectorCameraSnapshot));
      this.renderTreePanel();
      if (this.cameraTracking || this.inspectorCameraSnapshot) this.trackSelectedObject();
      this.toast(this.cameraTracking ? 'Câmera acompanhando ' + node.name + '.' : 'Rastreamento da câmera pausado.');
      return;
    }
    if (action === 'move') { this.startTreeMoveMode(id); return; }
    this.select(id);
    if (action === 'rename') {
      const name = await this.dialog({ title: 'Renomear objeto', label: 'Nome do objeto', value: node.name, confirm: 'Salvar' });
      if (name && name.trim() !== node.name) this.updateProperty('name', name);
    } else if (action === 'duplicate') this.duplicateSelected();
    else if (action === 'delete') this.deleteSelected();
  }


  renderEditor() {
    if (!this.project) return;
    this.renderTreePanel();
    const stageSize = this.getStageSize();
    this.applyStageBounds(stageSize);
    renderScene($('scene'), this.scene, { selectedId: this.store.state.selectedId, assets: this.assets, sceneSize: stageSize, zoom: this.zoom, cameraOffset: this.cameraOffset });
    this.renderInspectorPanel(this.scene.get(this.store.state.selectedId));
    $('project-name').textContent = this.project.name;
    this.updateHistory(this.history.status);
  }

  renderInspectorPanel(node) {
    renderInspector($('inspector'), node, {
      assets: this.assets,
      onChange: (key, value) => this.updateProperty(key, value),
      onEditStart: key => this.beginPropertyEdit(key),
      onPreview: (key, value) => this.previewProperty(key, value),
      onCommit: (key, value) => this.commitPropertyEdit(key, value),
      onDuplicate: () => this.duplicateSelected(),
      onDelete: () => { this.deleteSelected(); this.setPanel('stage'); },
      onAsset: id => this.updateProperty('assetId', id),
      events: this.project?.events || [],
      nodes: [...this.scene.nodes.values()],
      onEventSave: (nodeId, actions) => this.saveButtonAction(nodeId, actions)
    });
  }

  findAlignment(node, xOffset, yOffset) {
    const parentSize = parentId => {
      if (!parentId) return {
        width: $('scene').clientWidth || this.project?.settings?.width || 960,
        height: $('scene').clientHeight || this.project?.settings?.height || 640
      };
      const parent = this.scene.get(parentId);
      if (!parent) return { width: 960, height: 640 };
      const grand = parentSize(parent.parentId);
      const layout = resolveNodeLayout(parent, grand.width, grand.height);
      return { width: layout.width, height: layout.height };
    };
    const bounds = parentSize(node.parentId);
    const p = node.props;
    const width = Math.max(1, bounds.width * p.size.x.scale + p.size.x.offset);
    const height = Math.max(1, bounds.height * p.size.y.scale + p.size.y.offset);
    const left = bounds.width * p.position.x.scale + xOffset - width * p.anchorPoint.x;
    const top = bounds.height * p.position.y.scale + yOffset - height * p.anchorPoint.y;
    const movingX = [left, left + width / 2, left + width];
    const movingY = [top, top + height / 2, top + height];
    const targetsX = [0, bounds.width / 2, bounds.width];
    const targetsY = [0, bounds.height / 2, bounds.height];
    const siblings = node.parentId ? this.scene.get(node.parentId)?.children || [] : this.scene.roots;
    for (const id of siblings) {
      const other = this.scene.get(id);
      if (!other || other.id === node.id || other.props.visible === false) continue;
      const layout = resolveNodeLayout(other, bounds.width, bounds.height);
      targetsX.push(layout.x, layout.x + layout.width / 2, layout.x + layout.width);
      targetsY.push(layout.y, layout.y + layout.height / 2, layout.y + layout.height);
    }
    const threshold = 8 / this.zoom;
    const best = (moving, targets) => {
      let result = { delta: 0, guide: null, distance: threshold + 1 };
      for (const from of moving) for (const to of targets) {
        const distance = Math.abs(to - from);
        if (distance < result.distance) result = { delta: to - from, guide: to, distance };
      }
      return result.distance <= threshold ? result : { delta: 0, guide: null };
    };
    const sx = best(movingX, targetsX), sy = best(movingY, targetsY);
    return { dx: sx.delta, dy: sy.delta, guides: node.parentId ? { x: null, y: null } : { x: sx.guide, y: sy.guide } };
  }
  clearAlignmentGuides() {
    $('scene').querySelectorAll('.alignment-guide').forEach(guide => guide.remove());
  }

  showAlignmentGuides(guides) {
    this.clearAlignmentGuides();
    if (guides.x !== null) {
      const line = document.createElement('i');
      line.className = 'alignment-guide alignment-guide-x';
      line.style.left = guides.x + 'px';
      ($('scene').querySelector('.scene-world') || $('scene')).append(line);
    }
    if (guides.y !== null) {
      const line = document.createElement('i');
      line.className = 'alignment-guide alignment-guide-y';
      line.style.top = guides.y + 'px';
      ($('scene').querySelector('.scene-world') || $('scene')).append(line);
    }
  }

  screenDeltaToParent(target, dx, dy) {
    // Converte o deslocamento da tela para o espaço local do pai,
    // considerando o zoom do palco e rotações de todos os ancestrais.
    try {
      const scene = $('scene');
      const ancestors = [];
      let element = target.parentElement;
      while (element && element !== scene) {
        ancestors.push(element);
        element = element.parentElement;
      }
      let matrix = new DOMMatrix(getComputedStyle(scene).transform);
      for (const ancestor of ancestors.reverse()) {
        const transform = getComputedStyle(ancestor).transform;
        if (transform && transform !== 'none') matrix = matrix.multiply(new DOMMatrix(transform));
      }
      const inverse = matrix.inverse();
      return {
        x: inverse.a * dx + inverse.c * dy,
        y: inverse.b * dx + inverse.d * dy
      };
    } catch {
      return { x: dx / this.zoom, y: dy / this.zoom };
    }
  }

  finishSceneTap(event) {
    const tap = this.sceneTap;
    if (!tap || tap.pointerId !== event.pointerId) return;
    this.sceneTap = null;
    if (Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > 10 || this.runtime.running) return;
    this.select(tap.id);
  }

  pointerDown(event) {
    if (this.runtime.running || event.button > 0) return;
    let target = event.target.closest('.scene-node');
    if (!target) return;
    const node = this.scene.get(target.dataset.nodeId);
    if (!node) return;

    // Objeto não selecionado: aguarda o fim do gesto para confirmar um tap.
    // O primeiro toque nunca move, redimensiona ou gira.
    if (this.store.state.selectedId !== node.id) {
      this.sceneTap = { id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
      target.setPointerCapture?.(event.pointerId);
      return;
    }

    event.preventDefault();
    const resize = event.target.closest('[data-resize]')?.dataset.resize || null;
    const rotate = Boolean(event.target.closest('[data-rotate]'));
    const mode = rotate ? 'rotate' : resize ? 'resize' : 'move';
    const rect = target.getBoundingClientRect();
    const startAngle = Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
    this.drag = {
      historyRecorded: false,
      id: node.id, pointerId: event.pointerId, mode, direction: resize,
      startX: event.clientX, startY: event.clientY,
      pointerBasisX: this.screenDeltaToParent(target, 1, 0),
      pointerBasisY: this.screenDeltaToParent(target, 0, 1),
      x: Number(node.props.position.x.offset) || 0, y: Number(node.props.position.y.offset) || 0,
      left: target.offsetLeft - (target.offsetWidth * node.props.anchorPoint.x), top: target.offsetTop - (target.offsetHeight * node.props.anchorPoint.y),
      width: target.offsetWidth || 1, height: target.offsetHeight || 1,
      parentWidth: target.parentElement?.clientWidth || 960, parentHeight: target.parentElement?.clientHeight || 640,
      rotation: Number(node.props.rotation) || 0,
      centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2,
      startAngle, moved: false
    };
    target.setPointerCapture?.(event.pointerId);
    $('scene').classList.add('is-camera-interacting');
    const move = moveEvent => {
      const drag = this.drag;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      target = $('scene').querySelector('[data-node-id="' + CSS.escape(drag.id) + '"]') || target;
      const screenDx = moveEvent.clientX - drag.startX;
      const screenDy = moveEvent.clientY - drag.startY;
      // A base de conversão fica congelada no início do gesto. O rastreamento
      // pode mover/zoomar a câmera sem alterar a escala do arraste em andamento.
      const dx = drag.pointerBasisX.x * screenDx + drag.pointerBasisY.x * screenDy;
      const dy = drag.pointerBasisX.y * screenDx + drag.pointerBasisY.y * screenDy;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (!drag.moved) return;
      if (!drag.historyRecorded) { this.history.checkpoint(this.historySnapshot()); drag.historyRecorded = true; }
      const current = this.scene.get(drag.id);
      if (!current) return;
      if (drag.mode === 'move') {
        let nextX = drag.x + dx;
        let nextY = drag.y + dy;
        const snap = this.findAlignment(current, nextX, nextY);
        nextX += snap.dx;
        nextY += snap.dy;
        current.props.x = Math.round(nextX);
        current.props.y = Math.round(nextY);
        current.props.position.x.offset = current.props.x;
        current.props.position.y.offset = current.props.y;
        this.showAlignmentGuides(snap.guides);
      } else if (drag.mode === 'resize') {
        this.clearAlignmentGuides();
        const radians = drag.rotation * Math.PI / 180;
        const localDx = dx * Math.cos(radians) + dy * Math.sin(radians);
        const localDy = -dx * Math.sin(radians) + dy * Math.cos(radians);
        const dir = drag.direction;
        const rawWidth = drag.width + (dir.includes('e') ? localDx : dir.includes('w') ? -localDx : 0);
        const rawHeight = drag.height + (dir.includes('s') ? localDy : dir.includes('n') ? -localDy : 0);
        const width = Math.max(24, Math.min(2000, rawWidth));
        const height = Math.max(24, Math.min(2000, rawHeight));
        // Mantém a borda oposta fixa no espaço local e compensa a rotação no espaço do palco.
        const shiftLocalX = dir.includes('w') ? (drag.width - width) / 2 : dir.includes('e') ? (width - drag.width) / 2 : 0;
        const shiftLocalY = dir.includes('n') ? (drag.height - height) / 2 : dir.includes('s') ? (height - drag.height) / 2 : 0;
        const shiftWorldX = shiftLocalX * Math.cos(radians) - shiftLocalY * Math.sin(radians);
        const shiftWorldY = shiftLocalX * Math.sin(radians) + shiftLocalY * Math.cos(radians);
        const centerX = drag.left + drag.width / 2 + shiftWorldX;
        const centerY = drag.top + drag.height / 2 + shiftWorldY;
        const nextLeft = Math.round(centerX - width / 2);
        const nextTop = Math.round(centerY - height / 2);
        current.props.position.x.offset = Math.round(nextLeft + width * current.props.anchorPoint.x - drag.parentWidth * current.props.position.x.scale);
        current.props.position.y.offset = Math.round(nextTop + height * current.props.anchorPoint.y - drag.parentHeight * current.props.position.y.scale);
        current.props.size.x.offset = Math.round(width - drag.parentWidth * current.props.size.x.scale);
        current.props.size.y.offset = Math.round(height - drag.parentHeight * current.props.size.y.scale);
        current.props.x = current.props.position.x.offset;
        current.props.y = current.props.position.y.offset;
        current.props.width = current.props.size.x.offset;
        current.props.height = current.props.size.y.offset;
      } else {
        this.clearAlignmentGuides();
        const angle = Math.atan2(moveEvent.clientY - drag.centerY, moveEvent.clientX - drag.centerX);
        let angleDelta = angle - drag.startAngle;
        while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
        while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        current.props.rotation = Math.round((drag.rotation + angleDelta * 180 / Math.PI + 360) % 360);
      }
      const liveWidth = drag.parentWidth * current.props.size.x.scale + current.props.size.x.offset;
      const liveHeight = drag.parentHeight * current.props.size.y.scale + current.props.size.y.offset;
      updateSceneLayout($('scene'), this.scene, this.getStageSize());
      if (this.cameraTracking && this.cameraTrackingId === current.id) this.trackSelectedObject();
      const liveTarget = $('scene').querySelector('[data-node-id="' + CSS.escape(current.id) + '"]');
      const rotateHandle = liveTarget?.querySelector('.rotate-handle');
      if (rotateHandle) rotateHandle.style.transform = 'rotate(' + (-(Number(current.props.rotation) || 0)) + 'deg)';
    };
    const end = endEvent => {
      if (!this.drag || endEvent.pointerId !== this.drag.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const changed = this.drag.moved;
      this.drag = null;
      $('scene').classList.remove('is-camera-interacting');
      this.clearAlignmentGuides();
      if (changed) this.scheduleSave();
      this.renderEditor();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  getStageSize() {
    const host = $('stage-viewport');
    const fallbackWidth = Number(this.project?.settings?.width) || 960;
    const fallbackHeight = Number(this.project?.settings?.height) || 640;
    return {
      width: Math.max(1, Math.round(host?.clientWidth || fallbackWidth)),
      height: Math.max(1, Math.round(host?.clientHeight || fallbackHeight))
    };
  }

  applyStageBounds({ width, height }) {
    const scene = $('scene');
    const surface = $('scene-zoom');
    // O palco lógico acompanha a área útil real entre toolbar, painéis e dock.
    // A resolução antiga do projeto não impõe tamanho ao editor.
    scene.style.width = width + 'px';
    scene.style.height = height + 'px';
    surface.style.width = width + 'px';
    surface.style.height = height + 'px';
    $('scene-size').textContent = width + ' × ' + height;
    $('zoom-value').textContent = Math.round(this.zoom * 100) + '%';
  }

  setZoom(value) {
    this.zoom = value;
    const world = $('scene').querySelector('.scene-world');
    this.applyCameraOffset();
    $('zoom-value').textContent = Math.round(this.zoom * 100) + '%';
  }

  applyCameraOffset() {
    const world = $('scene').querySelector('.scene-world');
    if (world) {
      world.style.transformOrigin = '50% 50%';
      world.style.transform = 'translate3d(' + this.cameraOffset.x + 'px,' + this.cameraOffset.y + 'px,0) scale(' + this.zoom + ')';
    }
    const reset = $('camera-reset');
    if (reset) reset.hidden = !this.cameraEscaped && Math.abs(this.cameraOffset.x) < 1 && Math.abs(this.cameraOffset.y) < 1 && Math.abs(this.zoom - 1) < 0.01;
  }

  resetCamera() {
    this.cameraTracking = false;
    this.cameraTrackingId = null;
    this.cameraEscaped = false;
    this.inspectorCameraSnapshot = null;
    this.cameraOffset = { x: 0, y: 0 };
    this.zoom = 1;
    $('scene').classList.remove('is-camera-tracking');
    this.applyCameraOffset();
    this.renderTreePanel();
    $('zoom-value').textContent = '100%';
  }

  trackSelectedObject() {
    const temporary = !this.cameraTracking && this.store.state.panel === 'inspector' && Boolean(this.inspectorCameraSnapshot);
    const targetId = this.cameraTracking ? this.cameraTrackingId : this.store.state.selectedId;
    if ((!this.cameraTracking && !temporary) || this.store.state.screen !== 'editor' || !targetId || (!temporary && targetId !== this.store.state.selectedId)) return;
    if (this.cameraTrackFrame) cancelAnimationFrame(this.cameraTrackFrame);
    this.cameraTrackFrame = requestAnimationFrame(() => {
      this.cameraTrackFrame = 0;
      const viewport = $('stage-viewport');
      const target = $('scene').querySelector('[data-node-id="' + CSS.escape(targetId) + '"]');
      if (!viewport || !target || (!this.cameraTracking && !(this.store.state.panel === 'inspector' && this.inspectorCameraSnapshot)) || (this.cameraTracking && this.cameraTrackingId !== targetId)) return;
      const stage = viewport.getBoundingClientRect();
      const visible = { left: stage.left + 12, right: stage.right - 12, top: stage.top + 12, bottom: stage.bottom - 12 };
      if (this.store.state.panel === 'inspector') {
        const panel = document.querySelector('#screen-editor .inspector-panel');
        const panelRect = panel?.getBoundingClientRect();
        if (panelRect && panelRect.left < stage.right && panelRect.right > stage.left && panelRect.top < stage.bottom && panelRect.bottom > stage.top) visible.bottom = Math.min(visible.bottom, panelRect.top - 10);
      }
      const availableWidth = Math.max(1, visible.right - visible.left);
      const availableHeight = Math.max(1, visible.bottom - visible.top);
      if (availableWidth < 40 || availableHeight < 40) return;
      let rect = target.getBoundingClientRect();
      // Zoom não muda durante gestos de edição. Isso mantém a escala do ponteiro estável.
      if (!this.drag) {
        const fit = Math.min(1, (availableWidth - 24) / Math.max(1, rect.width), (availableHeight - 24) / Math.max(1, rect.height));
        if (fit < 0.995 && this.zoom > 0.25) {
          this.setZoom(Math.max(0.25, this.zoom * fit));
          rect = target.getBoundingClientRect();
        }
      }
      let dx = 0, dy = 0;
      if (rect.width > availableWidth) dx = (visible.left + visible.right) / 2 - (rect.left + rect.right) / 2;
      else if (rect.left < visible.left) dx = visible.left - rect.left;
      else if (rect.right > visible.right) dx = visible.right - rect.right;
      if (rect.height > availableHeight) dy = (visible.top + visible.bottom) / 2 - (rect.top + rect.bottom) / 2;
      else if (rect.top < visible.top) dy = visible.top - rect.top;
      else if (rect.bottom > visible.bottom) dy = visible.bottom - rect.bottom;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      this.cameraOffset = { x: this.cameraOffset.x + dx, y: this.cameraOffset.y + dy };
      const stageWidth = Math.max(1, stage.width), stageHeight = Math.max(1, stage.height);
      this.cameraEscaped = Math.abs(this.cameraOffset.x) > stageWidth * 0.3 || Math.abs(this.cameraOffset.y) > stageHeight * 0.3;
      this.applyCameraOffset();
    });
  }

  fitStage(resetZoom = false) {
    if (this.store.state.screen !== 'editor') return;
    if (resetZoom) {
      this.zoom = 1;
      this.cameraOffset = { x: 0, y: 0 };
      this.cameraEscaped = false;
      this.applyCameraOffset();
    }
    const size = this.getStageSize();
    this.applyStageBounds(size);
    if (this.project) {
      renderScene($('scene'), this.scene, {
        selectedId: this.store.state.selectedId,
        assets: this.assets,
        sceneSize: size,
        zoom: this.zoom,
        cameraOffset: this.cameraOffset
      });
      if (this.cameraTracking) this.trackSelectedObject();
    }
  }

  setPanel(name) {
    const shell = $('editor-shell');
    const current = shell.dataset.panel || 'stage';
    const next = name === current && name !== 'stage' ? 'stage' : name;
    if (!['stage', 'explorer', 'inspector'].includes(name)) return;
    if (current !== 'inspector' && next === 'inspector' && !this.cameraTracking) {
      this.inspectorCameraSnapshot = { offset: { ...this.cameraOffset }, zoom: this.zoom };
    } else if (current === 'inspector' && next !== 'inspector' && this.inspectorCameraSnapshot && !this.cameraTracking) {
      this.cameraOffset = { ...this.inspectorCameraSnapshot.offset };
      this.zoom = this.inspectorCameraSnapshot.zoom;
      this.inspectorCameraSnapshot = null;
      this.applyCameraOffset();
    }
    this.store.set({ panel: next });
    shell.dataset.panel = next;
    $('scene').classList.toggle('is-camera-tracking', this.cameraTracking || Boolean(this.inspectorCameraSnapshot));
    document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === next)));
    $('panel-close')?.setAttribute('aria-expanded', String(next === 'inspector'));
    $('explorer-close')?.setAttribute('aria-expanded', String(next === 'explorer'));
    if (next === 'stage') requestAnimationFrame(() => this.fitStage());
    else if (next === 'inspector' && (this.cameraTracking || this.inspectorCameraSnapshot)) setTimeout(() => this.trackSelectedObject(), 300);
    else if (this.cameraTracking) setTimeout(() => this.trackSelectedObject(), 120);
  }

  toggleAddMenu() {
    if ($('add-menu').hidden) this.openAddMenu();
    else this.closeAddMenu();
  }
  openAddMenu(parentId = null) {
    const parent = parentId ? this.scene.get(parentId) : this.scene.get(this.store.state.selectedId);
    this.addParentId = parent?.id ?? null;
    $('add-menu').hidden = false;
    $('add-menu-backdrop').hidden = false;
    $('object-search').value = '';
    $('object-dialog-title').textContent = parent ? 'Inserir instância' : 'Inserir objeto';
    $('object-parent-note').textContent = parent ? 'Parent: ' + parent.name + ' · a nova instância será filha deste objeto.' : 'Selecione uma classe para inserir no nível raiz.';
    $('object-parent-note').hidden = false;
    this.filterAddMenu('');
    $('mobile-add-objects').setAttribute('aria-expanded', 'true');
    // Não focar automaticamente: abrir o seletor não deve chamar o teclado móvel.
  }

  closeAddMenu() {
    $('add-menu').hidden = true;
    $('add-menu-backdrop').hidden = true;
    this.addParentId = null;
    $('mobile-add-objects').setAttribute('aria-expanded', 'false');
  }

  filterAddMenu(query) {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    let visible = 0;
    document.querySelectorAll('#object-options [data-add-type]').forEach(button => {
      const match = button.textContent.toLocaleLowerCase('pt-BR').includes(term);
      button.hidden = !match;
      if (match) visible++;
    });
    document.querySelectorAll('#object-options .object-category').forEach(category => {
      category.hidden = !category.querySelector('[data-add-type]:not([hidden])');
    });
    let empty = $('object-search-empty');
    if (!empty) {
      empty = document.createElement('p');
      empty.id = 'object-search-empty';
      empty.className = 'object-search-empty';
      empty.textContent = 'Nenhum objeto encontrado.';
      $('object-options').append(empty);
    }
    empty.hidden = visible > 0;
  }

  play() {
    if (!this.project) return;
    this.previewStageSize = this.getStageSize();
    this.previewScene = new Scene(this.scene.toJSON());
    this.runtime.start({ ...this.project, scene: this.previewScene.toJSON() }, this.previewScene);
    $('preview-screen').hidden = false;
    $('preview-screen').classList.remove('preview-visible');
    $('preview-name').textContent = this.project.name;
    const renderPreview = () => {
      renderScene($('preview-scene'), this.previewScene, {
        preview: true, assets: this.assets, sceneSize: this.previewStageSize,
        onRun: node => { this.runtime.dispatch(node, 'click'); renderPreview(); }
      });
      this.fitPreview();
    };
    renderPreview();
    requestAnimationFrame(() => {
      this.fitPreview();
      $('preview-screen').classList.add('preview-visible');
    });
  }

  fitPreview() {
    const viewport = $('preview-screen')?.querySelector('.preview-viewport');
    const canvas = $('preview-scene');
    const world = canvas?.querySelector('.scene-world');
    const size = this.previewStageSize;
    if (!viewport || !canvas || !world || !size) return;
    const style = getComputedStyle(viewport);
    const availableWidth = Math.max(1, viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const availableHeight = Math.max(1, viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    const scale = Math.min(availableWidth / size.width, availableHeight / size.height, 1);
    canvas.style.width = Math.max(1, size.width * scale) + 'px';
    canvas.style.height = Math.max(1, size.height * scale) + 'px';
    world.style.width = size.width + 'px';
    world.style.height = size.height + 'px';
    world.style.transformOrigin = 'top left';
    world.style.transform = 'scale(' + scale + ')';
  }

  stopPreview(announce = true) {
    if (!$('preview-screen').hidden) {
      const preview = $('preview-screen');
      preview.classList.remove('preview-visible');
      setTimeout(() => { if (!this.runtime.running) preview.hidden = true; }, 220);
    }
    if (this.runtime.running) this.runtime.stop();
    this.previewScene = null;
    this.previewStageSize = null;
    if (announce) this.renderEditor();
  }

  async openLibrary() {
    this.returnScreen = this.store.state.screen;
    this.assets = await this.db.listAssets();
    this.renderAssets();
    this.showScreen('library');
  }

  renderAssets() {
    const list = $('asset-list');
    list.replaceChildren();
    if (!this.assets.length) { list.append(this.empty('Sua biblioteca ainda está vazia.')); return; }
    for (const asset of this.assets) {
      const row = document.createElement('div');
      row.className = 'asset-row';
      const name = document.createElement('strong');
      name.textContent = asset.name;
      const meta = document.createElement('small');
      meta.textContent = asset.mime + ' · ' + this.formatBytes(asset.size);
      const remove = this.button('Excluir', 'button subtle danger-text');
      remove.dataset.removeAsset = asset.id;
      row.append(name, meta, remove);
      list.append(row);
    }
  }

  async uploadAssets(files) {
    for (const file of [...(files || [])]) {
      if (!file.size || file.size > 12 * 1024 * 1024) { this.toast(file.name + ': limite de 12 MB por arquivo.', 'warning'); continue; }
      if (!/^(image|video|audio)\//.test(file.type) && !/\.(woff2?|ttf|otf|svg|pdf|json|txt)$/i.test(file.name)) { this.toast(file.name + ': formato não permitido.', 'warning'); continue; }
      try { await this.db.saveAsset({ id: makeId(), name: file.name, blob: file }); } catch (error) { this.toast(error.message, 'error'); }
    }
    this.assets = await this.db.listAssets();
    this.renderAssets();
    $('asset-upload').value = '';
  }

  async removeAsset(id) {
    const projects = await this.db.listProjects();
    const used = projects.some(project => JSON.stringify(project.scene || []).includes('"assetId":"' + id + '"'));
    if (used) { this.toast('Este arquivo está em uso por um projeto. Remova a referência antes de excluir.', 'warning'); return; }
    await this.db.deleteAsset(id);
    this.assets = await this.db.listAssets();
    this.renderAssets();
  }

  async openSettings() {
    this.returnScreen = this.store.state.screen;
    $('settings-count').textContent = String(this.projects?.length || 0);
    $('settings-assets').textContent = String(this.assets.length);
    this.showScreen('settings');
  }

  async exportBackup() {
    try {
      const blob = await this.db.exportAll();
      this.download(blob, 'flowiq-studio-backup.flowiq-backup');
      this.toast('Backup exportado.');
    } catch (error) { this.toast(error.message, 'error'); }
  }

  async importBackup(file) {
    if (!file) return;
    try {
      const result = await this.db.importAll(file);
      this.toast(result.projects + ' projetos e ' + result.assets + ' arquivos importados.');
      await this.refreshProjects();
      this.assets = await this.db.listAssets();
    } catch (error) { this.toast(error.message, 'error'); }
    $('backup-input').value = '';
  }

  download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  keydown(event) {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (event.key === 'Escape') { this.stopPreview(false); this.closeAddMenu(); this.resolveDialog(null); }
    if (editing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.saveProject().catch(() => {}); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.store.state.screen === 'editor') { event.preventDefault(); this.duplicateSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'x') { event.preventDefault(); $('tree-search').focus(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.state.screen === 'editor') this.deleteSelected();
  }

  async dialog({ title, label = '', value = '', message = '', confirm = 'Confirmar', choices = null } = {}) {
    const dialog = $('dialog');
    dialog.replaceChildren();
    const box = document.createElement('section');
    box.className = 'dialog-card';
    const heading = document.createElement('h2');
    heading.textContent = title;
    box.append(heading);
    if (message) { const p = document.createElement('p'); p.textContent = message; box.append(p); }
    if (choices) {
      const actions = document.createElement('div');
      actions.className = 'dialog-actions stacked';
      for (const choice of choices) {
        const button = this.button(choice.label, 'button ' + (choice.value === 'cancel' ? 'subtle' : 'primary'));
        button.addEventListener('click', () => this.resolveDialog(choice.value));
        actions.append(button);
      }
      box.append(actions);
    } else {
      const input = document.createElement('input');
      input.value = value;
      input.maxLength = 64;
      input.setAttribute('aria-label', label);
      const labelNode = document.createElement('label');
      labelNode.textContent = label;
      labelNode.append(input);
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      const cancel = this.button('Cancelar', 'button subtle');
      cancel.addEventListener('click', () => this.resolveDialog(null));
      const save = this.button(confirm, 'button primary');
      save.addEventListener('click', () => this.resolveDialog(input.value.trim()));
      actions.append(cancel, save);
      box.append(labelNode, actions);
      setTimeout(() => input.focus(), 30);
    }
    dialog.append(box);
    dialog.hidden = false;
    dialog.classList.remove('dialog-closing');
    requestAnimationFrame(() => dialog.classList.add('dialog-visible'));
    return new Promise(resolve => { this.dialogResolve = resolve; });
  }

  async confirm(title, message) { return (await this.dialog({ title, message, choices: [{ value: 'yes', label: 'Confirmar' }, { value: 'no', label: 'Cancelar' }] })) === 'yes'; }

  resolveDialog(value) {
    const dialog = $('dialog');
    if (dialog.hidden || this.dialogClosing) return;
    this.dialogClosing = true;
    dialog.classList.remove('dialog-visible');
    dialog.classList.add('dialog-closing');
    const resolve = this.dialogResolve;
    this.dialogResolve = null;
    const finish = () => {
      if (!this.dialogClosing) return;
      dialog.hidden = true;
      dialog.classList.remove('dialog-closing');
      this.dialogClosing = false;
      resolve?.(value);
    };
    dialog.addEventListener('transitionend', event => { if (event.target === dialog && event.propertyName === 'opacity') finish(); }, { once: true });
    setTimeout(finish, 240);
  }

  toast(message, type = 'info') {
    const toast = $('toast');
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  log(message, type = 'info') {
    const row = document.createElement('p');
    row.className = 'log-line log-' + type;
    row.textContent = new Date().toLocaleTimeString('pt-BR') + '  ' + message;
    $('console-log').prepend(row);
  }

  empty(text) { const node = document.createElement('p'); node.className = 'empty-state'; node.textContent = text; return node; }
  button(text, className = 'button') { const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = text; return button; }
  formatBytes(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / 1048576).toFixed(1) + ' MB'; }
}

new FlowiqStudio();
