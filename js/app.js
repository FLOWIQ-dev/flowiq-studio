import { Store } from './core/store.js';
import { History } from './core/history.js';
import { Scene, COMPONENTS } from './data/model.js';
import { Database } from './data/database.js';
import { renderScene, renderTree, renderInspector } from './editor/view.js';
import { Runtime } from './runtime/runtime.js';

const $ = id => document.getElementById(id);
const makeId = () => crypto.randomUUID?.() || 'flowiq_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
const clone = value => structuredClone(value);

class FlowiqStudio {
  constructor() {
    this.db = new Database();
    this.store = new Store({ screen: 'home', project: null, selectedId: null, panel: 'explorer', busy: false });
    this.scene = new Scene();
    this.history = new History({ onChange: status => this.updateHistory(status) });
    this.runtime = new Runtime({ onLog: (message, type) => this.log(message, type) });
    this.assets = [];
    this.objectUrls = new Map();
    this.saveTimer = 0;
    this.drag = null;
    this.previewScene = null;
    this.dialogResolve = null;
    this.search = '';
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
    $('create-project').addEventListener('click', () => this.createProject());
    $('project-search').addEventListener('input', event => { this.search = event.target.value.trim().toLocaleLowerCase('pt-BR'); this.renderProjects(); });
    $('home-library').addEventListener('click', () => this.openLibrary());
    $('editor-library').addEventListener('click', () => this.openLibrary());
    $('home-settings').addEventListener('click', () => this.openSettings());
    $('back-home').addEventListener('click', () => this.returnHome());
    $('add-object').addEventListener('click', () => this.toggleAddMenu());
    $('add-menu').addEventListener('click', event => {
      const button = event.target.closest('[data-add-type]');
      if (button) this.addNode(button.dataset.addType);
    });
    $('tree').addEventListener('click', event => {
      const row = event.target.closest('[data-node-id]');
      if (row) this.select(row.dataset.nodeId);
    });
    $('scene').addEventListener('pointerdown', event => this.pointerDown(event));
    $('scene').addEventListener('click', event => {
      if (event.target === $('scene') && this.store.state.selectedId) this.select(null);
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
    $('zoom-fit').addEventListener('click', () => this.fitStage());
    $('save-project').addEventListener('click', () => this.saveProject());
    $('add-assets').addEventListener('click', () => $('asset-upload').click());
    $('asset-upload').addEventListener('change', event => this.uploadAssets(event.target.files));
    $('asset-list').addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-asset]');
      if (remove) this.removeAsset(remove.dataset.removeAsset);
    });
    $('export-backup').addEventListener('click', () => this.exportBackup());
    $('import-backup').addEventListener('click', () => $('backup-input').click());
    $('backup-input').addEventListener('change', event => this.importBackup(event.target.files?.[0]));
    $('settings-back').addEventListener('click', () => this.returnHome());
    $('library-back').addEventListener('click', () => this.returnHome());
    $('mobile-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-panel]');
      if (button) this.setPanel(button.dataset.panel);
    });
    $('panel-close').addEventListener('click', () => this.setPanel('stage'));
    $('dialog').addEventListener('click', event => { if (event.target === $('dialog')) this.resolveDialog(null); });
    document.addEventListener('keydown', event => this.keydown(event));
    window.addEventListener('beforeunload', event => {
      if (this.store.state.project && this.dirty) { event.preventDefault(); event.returnValue = ''; }
    });
  }

  get zoom() { return this._zoom || 1; }
  set zoom(value) { this._zoom = Math.max(0.35, Math.min(2, value)); }

  showScreen(screen) {
    this.store.set({ screen });
    for (const name of ['home', 'editor', 'library', 'settings']) $('screen-' + name).hidden = name !== screen;
    document.body.dataset.screen = screen;
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
      const rename = this.button('Renomear', 'button subtle');
      rename.addEventListener('click', () => this.renameProject(project));
      const remove = this.button('Excluir', 'button subtle danger-text');
      remove.addEventListener('click', () => this.deleteProject(project));
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
      this.scene = new Scene(project.scene || []);
      this.store.set({ project, selectedId: null, screen: 'editor', panel: 'stage' });
      this.history.clear();
      this.dirty = false;
      $('project-name').textContent = project.name;
      $('scene-size').textContent = (project.settings?.width || 960) + ' × ' + (project.settings?.height || 640);
      $('mobile-tabs').hidden = false;
      this.renderEditor();
      this.showScreen('editor');
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
      if (choice === 'save') await this.saveProject();
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
    this.project.scene = this.scene.toJSON();
    this.project.updatedAt = new Date().toISOString();
    try {
      await this.db.saveProject(this.project);
      this.dirty = false;
      $('save-state').textContent = 'Salvo';
      $('save-state').dataset.state = 'saved';
      await this.refreshProjects();
    } catch (error) {
      this.toast('Falha ao salvar: ' + error.message, 'error');
      throw error;
    }
  }

  scheduleSave() {
    this.dirty = true;
    $('save-state').textContent = 'Alterações não salvas';
    $('save-state').dataset.state = 'dirty';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveProject().catch(() => {}), 450);
  }

  addNode(type) {
    if (!COMPONENTS.some(item => item.type === type)) return;
    this.history.checkpoint(this.scene.snapshot());
    const parent = this.scene.get(this.store.state.selectedId);
    const node = this.scene.create(type, parent?.type === 'Frame' ? parent.id : null);
    this.select(node.id);
    $('add-menu').hidden = true;
    this.scheduleSave();
    this.renderEditor();
  }

  select(id) {
    if (id && !this.scene.get(id)) return;
    this.store.set({ selectedId: id });
    this.renderEditor();
  }

  updateProperty(key, value) {
    const node = this.scene.get(this.store.state.selectedId);
    if (!node) return;
    this.history.checkpoint(this.scene.snapshot());
    if (key === 'name') node.name = String(value).trim().slice(0, 64) || node.type;
    else if (['x', 'y'].includes(key)) node.props[key] = Math.max(-2000, Math.min(4000, Number(value) || 0));
    else if (['width', 'height'].includes(key)) node.props[key] = Math.max(1, Math.min(2000, Number(value) || 1));
    else if (key === 'opacity') node.props[key] = Math.max(0, Math.min(1, Number(value) || 0));
    else if (key === 'radius') node.props[key] = Math.max(0, Math.min(160, Number(value) || 0));
    else node.props[key] = value;
    this.scheduleSave();
    this.renderEditor();
  }

  saveButtonAction(nodeId, value) {
    const text = String(value || '').slice(0, 200);
    const events = Array.isArray(this.project.events) ? this.project.events : [];
    const existing = events.find(rule => rule.nodeId === nodeId && rule.event === 'click');
    if (existing) existing.actions = text ? [{ type: 'setText', targetId: nodeId, value: text }] : [];
    else if (text) events.push({ id: makeId(), nodeId, event: 'click', actions: [{ type: 'setText', targetId: nodeId, value: text }] });
    this.project.events = events.filter(rule => rule.actions?.length);
    this.scheduleSave();
    this.toast('Ação do botão salva.');
  }

  duplicateSelected() {
    const id = this.store.state.selectedId;
    if (!id) return;
    this.history.checkpoint(this.scene.snapshot());
    const copy = this.scene.duplicate(id);
    this.select(copy.id);
    this.scheduleSave();
  }

  deleteSelected() {
    const id = this.store.state.selectedId;
    if (!id) return;
    this.history.checkpoint(this.scene.snapshot());
    this.scene.remove(id);
    this.store.set({ selectedId: null });
    this.scheduleSave();
    this.renderEditor();
  }

  undo() {
    const snapshot = this.history.undo(this.scene.snapshot());
    if (!snapshot) return;
    this.scene = new Scene(snapshot);
    this.scheduleSave();
    this.renderEditor();
  }

  redo() {
    const snapshot = this.history.redo(this.scene.snapshot());
    if (!snapshot) return;
    this.scene = new Scene(snapshot);
    this.scheduleSave();
    this.renderEditor();
  }

  updateHistory(status) {
    $('undo').disabled = !status.canUndo;
    $('redo').disabled = !status.canRedo;
  }

  renderEditor() {
    if (!this.project) return;
    renderTree($('tree'), this.scene, this.store.state.selectedId, id => this.select(id));
    renderScene($('scene'), this.scene, { selectedId: this.store.state.selectedId, assets: this.assets });
    renderInspector($('inspector'), this.scene.get(this.store.state.selectedId), {
      assets: this.assets,
      onChange: (key, value) => this.updateProperty(key, value),
      onDelete: () => this.deleteSelected(),
      onAsset: id => this.updateProperty('assetId', id),
      events: this.project.events || [],
      onEventSave: (nodeId, value) => this.saveButtonAction(nodeId, value)
    });
    $('project-name').textContent = this.project.name;
    this.updateHistory(this.history.status);
  }

  pointerDown(event) {
    if (this.runtime.running) return;
    const target = event.target.closest('.scene-node');
    if (!target) return;
    const node = this.scene.get(target.dataset.nodeId);
    if (!node) return;
    event.preventDefault();
    if (this.store.state.selectedId !== node.id) {
      this.store.set({ selectedId: node.id });
      renderTree($('tree'), this.scene, node.id, id => this.select(id));
      renderInspector($('inspector'), node, { assets: this.assets, onChange: (key, value) => this.updateProperty(key, value), onDelete: () => this.deleteSelected(), onAsset: id => this.updateProperty('assetId', id) });
    }
    this.history.checkpoint(this.scene.snapshot());
    this.drag = { id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: Number(node.props.x) || 0, y: Number(node.props.y) || 0, moved: false };
    target.setPointerCapture?.(event.pointerId);
    const move = moveEvent => {
      if (!this.drag || moveEvent.pointerId !== this.drag.pointerId) return;
      const dx = (moveEvent.clientX - this.drag.startX) / this.zoom;
      const dy = (moveEvent.clientY - this.drag.startY) / this.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
      if (!this.drag.moved) return;
      const current = this.scene.get(this.drag.id);
      if (!current) return;
      current.props.x = Math.round(this.drag.x + dx);
      current.props.y = Math.round(this.drag.y + dy);
      target.style.left = current.props.x + 'px';
      target.style.top = current.props.y + 'px';
    };
    const end = endEvent => {
      if (!this.drag || endEvent.pointerId !== this.drag.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const changed = this.drag.moved;
      this.drag = null;
      if (changed) { this.scheduleSave(); this.renderEditor(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  setZoom(value) {
    this.zoom = value;
    $('scene-zoom').style.transform = 'scale(' + this.zoom + ')';
    $('zoom-value').textContent = Math.round(this.zoom * 100) + '%';
  }

  fitStage() {
    if (this.store.state.screen !== 'editor') return;
    const host = $('stage-viewport');
    if (!host) return;
    const scale = Math.min((host.clientWidth - 48) / 960, (host.clientHeight - 48) / 640, 1);
    this.setZoom(Math.max(0.35, scale || 1));
  }

  setPanel(name) {
    this.store.set({ panel: name });
    $('editor-shell').dataset.panel = name;
    document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === name)));
  }

  toggleAddMenu() { $('add-menu').hidden = !$('add-menu').hidden; }

  play() {
    if (!this.project) return;
    this.previewScene = new Scene(this.scene.toJSON());
    this.runtime.start({ ...this.project, scene: this.previewScene.toJSON() }, this.previewScene);
    $('preview-screen').hidden = false;
    $('preview-name').textContent = this.project.name;
    const renderPreview = () => renderScene($('preview-scene'), this.previewScene, { preview: true, assets: this.assets, onRun: node => { this.runtime.dispatch(node, 'click'); renderPreview(); } });
    renderPreview();
  }

  stopPreview(announce = true) {
    if (!$('preview-screen').hidden) $('preview-screen').hidden = true;
    if (this.runtime.running) this.runtime.stop();
    this.previewScene = null;
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
    if (event.key === 'Escape') { this.stopPreview(false); $('add-menu').hidden = true; this.resolveDialog(null); }
    if (editing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.saveProject(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.store.state.screen === 'editor') { event.preventDefault(); this.duplicateSelected(); }
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
    return new Promise(resolve => { this.dialogResolve = resolve; });
  }

  async confirm(title, message) { return (await this.dialog({ title, message, choices: [{ value: 'yes', label: 'Confirmar' }, { value: 'no', label: 'Cancelar' }] })) === 'yes'; }

  resolveDialog(value) {
    if ($('dialog').hidden) return;
    $('dialog').hidden = true;
    const resolve = this.dialogResolve;
    this.dialogResolve = null;
    resolve?.(value);
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
