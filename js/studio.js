import { DataModel, Instance } from './datamodel.js?v=2026.11.16.70';
import { VirtualFS } from './vfs.js?v=2026.11.16.70';
import { createProjectRecord, normalizeProject, FlowiqRuntime } from './engine.js?v=2026.11.16.70';
import { createBackupFile, inspectBackupFile, restoreBackup } from './backup.js?v=2026.11.16.70';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const iconMarkup = (type) => {
  const paths = {
    Project:'<path d="M3.5 7h6l2 2h9v10h-17z"/><path d="M3.5 7V5h6l2 2"/>',
    Frame:'<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M8 8h8v8H8z"/>',
    TextButton:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 9h8M12 9v6m-3 0h6"/>',
    TextLabel:'<path d="M4 6h16M12 6v13M8 19h8"/>',
    ImageLabel:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[type]||paths.Frame)+'</svg>';
};

const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;

const hexToRgb = value => { const m=/^#?([0-9a-f]{6})$/i.exec(String(value||'')); if(!m)return {r:255,g:255,b:255}; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };
const rgbToHex = (r,g,b) => '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(Number(v)||0))).toString(16).padStart(2,'0')).join('').toUpperCase();
const rgbToHsv = (r,g,b) => {r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}return {h,s:max===0?0:d/max,v:max};};
const hsvToHex = (h,s,v) => {const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c/2;let r=0,g=0,b=0;if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);};


class StudioApp {
  constructor() {
    this.vfs = new VirtualFS();
    this.model = new DataModel();
    this.runtime = new FlowiqRuntime({ model:this.model, onChange:()=>this.renderCanvas(), onLog:message=>this.log(message,'warn') });
    this.projects = [];
    this.assetBrowser = null;
    this.libraryReturnTo = 'hub';
    this.settingsReturnTo = 'hub';
    this.focusMode = false;
    this.selectedAssetId = null;
    this.preferences = this.loadPreferences();
    this.assetUrls = new Map();
    this.assets = [];
    this.assetSearch = '';
    this.assetFolder = '';
    this.assetType = 'all';
    this.project = null;
    this.selected = null;
    this.expandedNodes = new Set();
    this.treeQuery = '';
    this.treeDragId = null;
    this.treeMenu = null;
    this.drag = null;
    this.lastTap = null;
    this.lastTapTimer = null;
    this.saveTimer = null;
    this.saving = false;
    this.savePending = false;
    this.savePromise = null;
    this.playMode = false;
    this.zoom = 1;
    this.smartAlign = true;
    this.gridVisible = true;
    this.undoStack = [];
    this.redoStack = [];
    this.smartAlign=this.preferences.smartAlign;
    this.gridVisible=this.preferences.gridVisible;
    this.bind();
    this.loadHub();
  }

  bind() {
    $('btn-new').onclick = () => this.createProject();
    const hubButton=$('btn-hub');
    if(hubButton)hubButton.onclick=async()=>this.leaveProject();
    const homeButton=$('btn-home');
    if(homeButton)homeButton.onclick=async()=>this.leaveProject();
    $('library-back').onclick=()=>this.closeLibrary();
    document.addEventListener('click',async event=>{
      const toggle=event.target.closest('[data-studio-menu-toggle]');
      if(toggle){event.stopPropagation();const menu=toggle.parentElement.querySelector('[data-studio-menu]');const opening=menu.hidden;document.querySelectorAll('[data-studio-menu]').forEach(item=>item.hidden=true);document.querySelectorAll('[data-studio-menu-toggle]').forEach(item=>item.setAttribute('aria-expanded','false'));menu.hidden=!opening;toggle.setAttribute('aria-expanded',String(opening));return;}
      if(!event.target.closest('.studio-menu-wrap')){document.querySelectorAll('[data-studio-menu]').forEach(item=>item.hidden=true);document.querySelectorAll('[data-studio-menu-toggle]').forEach(item=>item.setAttribute('aria-expanded','false'));}
      const action=event.target.closest('[data-studio-action]');if(!action)return;
      document.querySelectorAll('[data-studio-menu]').forEach(item=>item.hidden=true);document.querySelectorAll('[data-studio-menu-toggle]').forEach(item=>item.setAttribute('aria-expanded','false'));
      if(action.dataset.studioAction==='settings')await this.openSettingsFromEditor();
      if(action.dataset.studioAction==='library')await this.openLibrary();
    });
    $('btn-focus-stage').onclick=()=>this.toggleFocusMode();
    $('preview-exit').onclick = () => this.play(false);
    document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-color-id]')||event.target.closest('[data-color-popover]'))return;document.querySelectorAll('[data-color-popover]').forEach(pop=>{pop.hidden=true;pop.remove();});document.querySelectorAll('[data-color-toggle]').forEach(btn=>btn.setAttribute('aria-expanded','false'));});
    document.addEventListener('scroll',event=>{if(event.target?.closest?.('[data-color-popover]')||document.activeElement?.closest?.('[data-color-popover]'))return;document.querySelectorAll('[data-color-popover]').forEach(pop=>{pop.hidden=true;pop.remove();});document.querySelectorAll('[data-color-toggle]').forEach(btn=>btn.setAttribute('aria-expanded','false'));},true);
    window.addEventListener('resize',()=>{if(document.activeElement?.closest?.('[data-color-popover]'))return;document.querySelectorAll('[data-color-popover]').forEach(pop=>{pop.hidden=true;pop.remove();});document.querySelectorAll('[data-color-toggle]').forEach(btn=>btn.setAttribute('aria-expanded','false'));});
    $('settings-return-project').onclick = () => this.returnFromSettings();
    $('btn-save').onclick = () => this.save();
    $('settings-export-backup').onclick = () => this.exportFullBackup();
    $('settings-restore-backup').onclick = () => $('backup-file-input').click();
    $('settings-import-project').onclick = () => $('file-input').click();
    $('settings-export-project').onclick = () => this.exportProject();
    $('pref-grid').onchange = e => { this.preferences.gridVisible=e.target.checked; this.savePreferences(); this.applyPreferences(); };
    $('pref-smart-align').onchange = e => { this.preferences.smartAlign=e.target.checked; this.savePreferences(); this.applyPreferences(); };
    $('project-search').oninput = e => { this.projectSearch=e.target.value.trim().toLocaleLowerCase('pt-BR'); this.renderHub(); };
    $('file-input').onchange = (e) => this.importProject(e.target.files?.[0]);
    document.querySelectorAll('[data-hub-view]').forEach(button=>button.onclick=()=>this.showHubView(button.dataset.hubView));
    $('asset-upload-button').onclick = () => $('asset-file-input').click();
    $('asset-file-input').onchange = e => this.uploadAssets(e.target.files);
    $('asset-search').oninput = e => { this.assetSearch=e.target.value.trim().toLocaleLowerCase('pt-BR'); this.renderLibrary(); };
    $('asset-folder-filter').onchange = e => { this.assetFolder=e.target.value; this.renderLibrary(); };
    $('asset-type-filter').onchange = e => { this.assetType=e.target.value; this.renderLibrary(); };
    $('open-project-library').onclick = () => this.openProjectLibrary();
    $('backup-file-input').onchange = (e) => this.importFullBackup(e.target.files?.[0]);
    $('file-input').onchange = (e) => this.importProject(e.target.files?.[0]);
    $('open-instances').onclick = () => this.toggleInstanceLibrary();
    $('close-instances').onclick = () => this.closeInstanceLibrary();
    $('instance-library').querySelectorAll('[data-instance]').forEach(button => button.onclick = () => this.add(button.dataset.instance));
    $('instance-library').querySelectorAll('[data-instance-icon]').forEach(icon => { icon.innerHTML = iconMarkup(icon.dataset.instanceIcon); });
    $('tree-search').oninput = (e) => { this.treeQuery = e.target.value.trim().toLocaleLowerCase('pt-BR'); this.renderTree(); };
    $('btn-play').onclick = () => this.play();
    $('zoom-in').onclick = () => this.setZoom(this.zoom + 0.1);
    $('zoom-out').onclick = () => this.setZoom(this.zoom - 0.1);
    $('zoom-fit').onclick = () => this.fitCanvas();
    $('show-explorer').onclick = () => this.toggleDesktopPanel('explorer');
    $('show-inspector').onclick = () => this.toggleDesktopPanel('inspector');
    $('btn-grid').onclick = () => { this.gridVisible=!this.gridVisible; this.preferences.gridVisible=this.gridVisible; this.savePreferences(); this.applyPreferences(); };
    const setPositionMode=enabled=>{this.smartAlign=enabled;this.preferences.smartAlign=enabled;this.savePreferences();$('btn-align').setAttribute('aria-pressed',String(enabled));$('btn-free').setAttribute('aria-pressed',String(!enabled));$('btn-align').classList.toggle('is-active',enabled);$('btn-free').classList.toggle('is-active',!enabled);$('btn-align').title=enabled?'Alinhamento inteligente ativo':'Ativar alinhamento inteligente';$('btn-free').title=enabled?'Ativar posicionamento totalmente livre':'Posicionamento totalmente livre ativo';if(!enabled)this.clearAlignmentGuides();};$('btn-align').onclick=()=>setPositionMode(true);$('btn-free').onclick=()=>setPositionMode(false);

    $('undo-action').onclick = () => this.undo();
    $('redo-action').onclick = () => this.redo();
    $('clear-console').onclick = () => $('console-log').replaceChildren();
    $('drawer-backdrop').onclick = () => this.closePanels();
    document.querySelectorAll('[data-panel]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); b.onclick = () => this.togglePanel(b.dataset.panel); });
    document.querySelectorAll('[data-close-panel]').forEach((b) => b.onclick = () => this.closePanels());
    $('canvas').addEventListener('click', (e) => {
      if (e.target === $('canvas') && !this.playMode) this.select(null);
    });
    $('canvas').addEventListener('pointerdown', (e) => this.startDrag(e));
    $('stage-scroll').addEventListener('scroll', () => this.updateRotateHandlePlacement(), {passive:true});
    document.addEventListener('pointermove', (e) => this.moveDrag(e));
    document.addEventListener('pointerup', (e) => this.endDrag(e));
    document.addEventListener('pointercancel', (e) => this.endDrag(e));
    window.addEventListener('resize', () => { this.renderSelectionHandles(); });
    document.addEventListener('click', (e) => { if(this.treeMenu && !this.treeMenu.contains(e.target)) this.closeTreeMenu(); });
    document.addEventListener('keydown', (e) => {
      if(e.key==='Escape'){document.querySelectorAll('[data-studio-menu]').forEach(item=>item.hidden=true);document.querySelectorAll('[data-studio-menu-toggle]').forEach(item=>item.setAttribute('aria-expanded','false'));$('asset-preview-pane')?.classList.remove('asset-preview-open');document.body.classList.remove('asset-viewer-open');}
      const editingText = ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !editingText) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !editingText) { e.preventDefault(); this.redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === '0') { e.preventDefault(); this.fitCanvas(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && this.selected) { e.preventDefault(); this.duplicateSelected(); }
      if (e.key === 'Escape') { closeWorkspaceMenu(); this.closeTreeMenu(); this.closePanels(); this.hideModal(); if (this.playMode) this.play(false); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) this.deleteSelected();
      if (e.key === 'F2' && this.selected && !editingText) this.renameNode(this.selected);
    });
    $('modal').onclick = (e) => { if (e.target === $('modal')) this.hideModal(); };
  }

  loadPreferences() {
    const defaults={gridVisible:true,smartAlign:true};
    try{return {...defaults,...JSON.parse(localStorage.getItem('flowiq-studio-preferences-v1')||'{}')};}
    catch{return defaults;}
  }

  savePreferences() {
    try{localStorage.setItem('flowiq-studio-preferences-v1',JSON.stringify(this.preferences));}
    catch(error){this.notify('Não foi possível salvar as preferências neste navegador.','warning');}
  }

  applyPreferences() {
    this.gridVisible=Boolean(this.preferences.gridVisible);
    this.smartAlign=Boolean(this.preferences.smartAlign);
    $('stage-scroll')?.classList.toggle('grid-hidden',!this.gridVisible);
    $('btn-grid')?.setAttribute('aria-pressed',String(this.gridVisible));
    if($('btn-grid'))$('btn-grid').title=this.gridVisible?'Grade visível':'Grade oculta';
    $('btn-align')?.setAttribute('aria-pressed',String(this.smartAlign));
    $('btn-free')?.setAttribute('aria-pressed',String(!this.smartAlign));
    $('btn-align')?.classList.toggle('is-active',this.smartAlign);
    $('btn-free')?.classList.toggle('is-active',!this.smartAlign);
    if($('pref-grid'))$('pref-grid').checked=this.gridVisible;
    if($('pref-smart-align'))$('pref-smart-align').checked=this.smartAlign;
  }

  renderSettings() {
    const total=this.assets.reduce((sum,a)=>sum+(Number(a.size)||0),0);
    $('settings-project-count').textContent=String(this.projects.length);
    $('settings-asset-count').textContent=String(this.assets.length);
    $('settings-storage-size').textContent=this.formatBytes(total);
    $('settings-export-project').disabled=!this.project;
    $('settings-export-project').classList.toggle('is-disabled',!this.project);
    $('settings-export-project').querySelector('small').textContent=this.project?'Salvar '+this.project.name+' e os arquivos que ele utiliza.':'Abra um projeto para habilitar esta opção.';
    $('settings-version').textContent='Versão 2026.11.16.70';
    this.applyPreferences();
  }

  async openSettingsFromEditor() {
    if(this.playMode)this.play(false);
    this.settingsReturnTo=$('library-screen').classList.contains('active')?'library':(this.project?'editor':'hub');
    if(this.project)await this.save();
    $('workspace').classList.remove('active');$('library-screen').classList.remove('active');
    $('hub').classList.add('active');
    await this.loadHub();
    this.showHubView('settings');
  }

  async returnFromSettings() {
    if(this.settingsReturnTo==='library'){$('hub').classList.remove('active');$('library-screen').classList.add('active');await this.loadHub();this.renderLibrary();return;}
    if(this.settingsReturnTo==='editor'&&this.project){await this.returnToEditor();return;}
    this.showHubView('home');
  }

  async openLibrary() {
    if(this.playMode)this.play(false);
    if(!$('library-screen').classList.contains('active'))this.libraryReturnTo=$('workspace').classList.contains('active')?'editor':($('hub-settings-view').classList.contains('active')?'settings':'hub');
    if(this.project)await this.save();
    $('workspace').classList.remove('active');$('hub').classList.remove('active');
    $('library-screen').classList.add('active');
    await this.loadHub();
    this.renderLibrary();
  }

  async closeLibrary() {
    $('library-screen').classList.remove('active');
    if(this.libraryReturnTo==='editor'&&this.project){$('workspace').classList.add('active');this.refresh();this.applyPreferences();requestAnimationFrame(()=>this.fitCanvas());}
    else{$('hub').classList.add('active');this.showHubView(this.libraryReturnTo==='settings'?'settings':'home');}
  }

  toggleFocusMode(force) {
    this.focusMode=typeof force==='boolean'?force:!this.focusMode;
    $('workspace').classList.toggle('focus-mode',this.focusMode);
    $('btn-focus-stage').setAttribute('aria-pressed',String(this.focusMode));
    $('btn-focus-stage').setAttribute('aria-label',this.focusMode?'Sair do foco no palco':'Focar no palco');
    $('btn-focus-stage').title=this.focusMode?'Mostrar painéis':'Focar no palco';
    if(this.focusMode)this.closePanels();
    requestAnimationFrame(()=>{this.renderSelectionHandles();this.updateRotateHandlePlacement();});
  }

  async returnToEditor() {
    if(!this.project){this.showHubView('home');return;}
    $('hub').classList.remove('active');
    $('workspace').classList.add('active');
    this.refresh();
    document.querySelectorAll('[data-workspace-nav]').forEach(item=>item.classList.toggle('active',item.dataset.workspaceNav==='editor'));
    this.applyPreferences();
    this.fitCanvas();
  }

  async loadHub() {
    try { this.projects = await this.vfs.getProjects(); this.assets = await this.vfs.getAssets(); this.renderHub(); this.renderLibrary(); }
    catch (e) { this.log('Falha ao abrir armazenamento: ' + e.message, 'error'); $('project-list').innerHTML = '<div class="empty">Não foi possível acessar os projetos. Verifique se o navegador permite armazenamento local.</div>'; }
  }

  renderHub() {
    const sorted=[...this.projects].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    const count=this.projects.length;
    $('project-count').textContent=count+(count===1?' projeto':' projetos');
    const matches=sorted.filter(p=>!this.projectSearch||(p.name||'').toLocaleLowerCase('pt-BR').includes(this.projectSearch));
    const card=p=>'<article class="project-card"><button class="project-card-open" data-open="'+esc(p.id)+'"><span class="project-glyph"><img src="./assets/icon.svg" alt=""></span><span class="project-card-copy"><strong>'+esc(p.name)+'</strong><small>Modificado em '+new Date(p.updatedAt||Date.now()).toLocaleDateString('pt-BR')+'</small></span><svg class="project-card-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button><div class="project-card-tools"><button data-rename-project="'+esc(p.id)+'">Renomear</button><button data-delete="'+esc(p.id)+'">Excluir</button></div></article>';
    const empty='<div class="empty-project-state"><span class="empty-project-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span><strong>'+(this.projectSearch?'Nenhum projeto encontrado':'Seu primeiro projeto começa aqui')+'</strong><small>'+(this.projectSearch?'Tente outro nome.':'Use o botão “Novo projeto” no topo para começar sua criação.')+'</small></div>';
    $('project-list').innerHTML=matches.length?matches.map(card).join(''):empty;
    document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>this.openProject(b.dataset.open));
    document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>this.deleteProject(b.dataset.delete));
    document.querySelectorAll('[data-rename-project]').forEach(b=>b.onclick=()=>this.renameProject(b.dataset.renameProject));

    this.renderSettings();
  }

  showHubView(view) {
    const active=view==='settings'?'settings':'home';
    for(const key of ['home','settings'])$('hub-'+key+'-view').classList.toggle('active',key===active);
    $('btn-new').hidden=active==='settings';
    if(active==='settings')this.renderSettings();
  }

  renderLibrary() {
    const total=this.assets.reduce((sum,a)=>sum+(Number(a.size)||0),0);
    $('library-summary-text').textContent=this.assets.length+' arquivos · '+this.formatBytes(total);
    const folders=[...new Set(this.assets.map(a=>a.folder).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const folderSelect=$('asset-folder-filter'),previous=this.assetFolder;
    folderSelect.innerHTML='<option value="">Todas as pastas</option>'+folders.map(f=>'<option value="'+esc(f)+'">'+esc(f)+'</option>').join('');
    if(folders.includes(previous))folderSelect.value=previous;else this.assetFolder='';
    const typeSelect=$('asset-type-filter');if(typeSelect)typeSelect.value=this.assetType;
    this.enhanceSelects($('hub-library-view'));
    const category=a=>{const mime=a.mime||'',name=a.name||'';if(mime.startsWith('image/')||/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name))return'image';if(mime.startsWith('video/'))return'video';if(mime.startsWith('audio/'))return'audio';if(mime.startsWith('font/')||/\.(woff2?|ttf|otf)$/i.test(name))return'font';return'document';};
    const filtered=this.assets.filter(a=>(!this.assetFolder||a.folder===this.assetFolder)&&(this.assetType==='all'||category(a)===this.assetType)&&(!this.assetSearch||(a.name+' '+a.mime+' '+(a.folder||'')).toLocaleLowerCase('pt-BR').includes(this.assetSearch)));
    const list=$('asset-list');
    if(!filtered.length){
      this.previewRequestId=(this.previewRequestId||0)+1;
      this.selectedAssetId=null;$('asset-preview-pane').classList.remove('asset-preview-open');document.body.classList.remove('asset-viewer-open');
      list.innerHTML='<div class="empty-project-state"><span class="empty-project-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v15H4zM8 9h8M8 13h5"/></svg></span><strong>'+(this.assets.length?'Nenhum arquivo encontrado':'Biblioteca vazia')+'</strong><small>'+(this.assets.length?'Altere a busca ou o filtro de pasta.':'Adicione imagens, áudio, vídeo e documentos para usar nos projetos.')+'</small></div>';
      $('asset-preview-pane').innerHTML='<div class="preview-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg><strong>Nenhum arquivo selecionado</strong><span>Escolha um arquivo na lista para visualizar.</span></div>';
      return;
    }
    if(!filtered.some(a=>a.id===this.selectedAssetId))this.selectedAssetId=null;
    const iconFor=a=>{
      const mime=a.mime||'',name=a.name||'';
      const image=mime.startsWith('image/')||/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name);
      const video=mime.startsWith('video/')||/\.(mp4|webm|mov|m4v)$/i.test(name);
      const audio=mime.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name);
      const pdf=mime==='application/pdf'||/\.pdf$/i.test(name);
      const font=/font|\.(woff2?|ttf|otf)$/i.test(mime+' '+name);
      const path=image?'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>':video?'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>':audio?'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>':pdf?'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 16h6"/>':font?'<path d="m4 20 8-17 8 17M7 14h10"/>':'<path d="M5 3h9l5 5v13H5zM14 3v5h5"/>';
      return '<svg viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';
    };
    list.innerHTML=filtered.map(a=>{let thumb=iconFor(a);if(a.mime?.startsWith('image/')){try{thumb='<img src="'+this.assetUrl(a)+'" alt="">';}catch{}}return '<button class="asset-entry '+(a.id===this.selectedAssetId?'selected':'')+'" data-asset-select="'+esc(a.id)+'"><span class="asset-entry-thumb">'+thumb+'</span><span class="asset-entry-copy"><strong>'+esc(a.name)+'</strong><small>'+esc(a.folder||'Sem pasta')+' · '+this.formatBytes(a.size||0)+'</small></span><svg class="asset-entry-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>';}).join('');
    list.querySelectorAll('[data-asset-select]').forEach(b=>b.onclick=()=>{this.selectedAssetId=b.dataset.assetSelect;this.renderLibrary();});
    if(this.selectedAssetId)this.renderAssetPreview(this.assets.find(a=>a.id===this.selectedAssetId));else {$('asset-preview-pane').classList.remove('asset-preview-open');document.body.classList.remove('asset-viewer-open');}
  }

  async renderAssetPreview(asset) {
    const pane=$('asset-preview-pane');if(!pane)return;
    const requestId=this.previewRequestId=(this.previewRequestId||0)+1;
    if(!asset){this.previewRequestId++;pane.innerHTML='<div class="preview-empty"><strong>Selecione um arquivo</strong></div>';return;}
    const mime=asset.mime||'',name=asset.name||'',url=(()=>{try{return this.assetUrl(asset)}catch{return null}})();
    const isImage=mime.startsWith('image/')||/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name);
    const isVideo=mime.startsWith('video/')||/\.(mp4|webm|mov|m4v)$/i.test(name);
    const isAudio=mime.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name);
    const isPdf=mime==='application/pdf'||/\.pdf$/i.test(name);
    let content='<div class="preview-unsupported"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9l5 5v13H5zM14 3v5h5"/></svg><strong>Prévia não disponível</strong><span>Este formato pode ser baixado e usado no projeto.</span></div>';
    if(!url){content='<div class="preview-unsupported"><strong>Arquivo indisponível</strong><span>O conteúdo não foi encontrado no armazenamento local.</span></div>';}
    else if(isImage)content='<div class="preview-media image-preview"><img id="asset-preview-image" src="'+url+'" alt="'+esc(name)+'"></div>';
    else if(isVideo)content='<div class="preview-media"><video src="'+url+'" controls playsinline preload="metadata"></video></div>';
    else if(isAudio)content='<div class="preview-audio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><audio src="'+url+'" controls preload="metadata"></audio></div>';
    else if(isPdf)content='<iframe class="preview-pdf" src="'+url+'" title="'+esc(name)+'"></iframe>';
    else if(/(text|json|svg|xml)/i.test(mime)||/\.(txt|json|svg|xml|md|html|css|js)$/i.test(name)){
      try{const raw=await asset.blob.text();content='<pre class="preview-code">'+esc(raw.slice(0,60000))+'</pre>';}
      catch{content='<div class="preview-unsupported"><strong>Não foi possível ler o arquivo.</strong></div>';}
    }
    if(requestId!==this.previewRequestId||this.selectedAssetId!==asset.id)return;
    document.body.classList.add('asset-viewer-open');pane.classList.add('asset-preview-open');pane.setAttribute('role','dialog');pane.setAttribute('aria-label','Visualizador de arquivos');pane.innerHTML='<div class="preview-pane-heading"><div><strong>'+esc(name)+'</strong><small>'+esc(mime||'Arquivo')+' · '+this.formatBytes(asset.size||0)+'</small></div><button class="icon-action preview-close" id="preview-clear" aria-label="Fechar pré-visualização"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="preview-pane-content">'+content+'</div><div class="preview-pane-actions"><button class="btn" id="preview-rename">Renomear</button><button class="btn" id="preview-move">Mover</button><button class="btn danger" id="preview-delete">Excluir</button><button class="btn primary" id="preview-download"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 17v3h14v-3"/></svg>Baixar</button></div>';
    $('preview-clear').onclick=()=>{pane.classList.remove('asset-preview-open');document.body.classList.remove('asset-viewer-open');pane.removeAttribute('role');this.selectedAssetId=null;this.renderLibrary();};
    $('preview-rename').onclick=()=>this.renameAsset(asset.id);
    $('preview-move').onclick=()=>this.moveAsset(asset.id);
    $('preview-delete').onclick=()=>this.deleteAsset(asset.id);
    $('preview-download').onclick=()=>this.downloadAsset(asset.id);
    const image=$('asset-preview-image');if(image)image.onerror=()=>{const target=$('asset-preview-pane')?.querySelector('.preview-pane-content');if(target)target.innerHTML='<div class="preview-unsupported"><strong>Não foi possível exibir a imagem.</strong><span>O arquivo pode estar corrompido ou em um formato não suportado.</span></div>';};
  }

  async refreshLibrary() {
    try { this.assets = await this.vfs.getAssets(); this.renderLibrary(); }
    catch (error) { $('asset-list').innerHTML = '<div class="empty">Não foi possível abrir a biblioteca: '+esc(error.message)+'</div>'; }
  }

  notify(message,type='info') {
    const host=$('studio-toast');if(!host)return;
    const paths={success:'<path d="m5 12 4 4L19 6"/>',warning:'<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',error:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'};
    const icon=document.createElement('svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.innerHTML=paths[type]||paths.info;
    const content=document.createElement('span');content.textContent=String(message||'');host.replaceChildren(icon,content);host.dataset.type=type;host.classList.add('show');
    clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>host.classList.remove('show'),5200);
  }

  formatBytes(bytes) {
    if (bytes < 1024) return bytes+' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1)+' KB';
    return (bytes/1048576).toFixed(2)+' MB';
  }

  openAsset(id) { this.selectedAssetId=id;this.renderLibrary(); }

  async openProjectLibrary(node=null) {
    await this.refreshLibrary();
    this.assetBrowser={node,query:'',folder:''};
    this.renderProjectLibraryBrowser(node);
    $('modal').classList.add('open');
    $('modal-content').classList.add('asset-browser-modal');
  }

  renderProjectLibraryBrowser(node=null) {
    const state=this.assetBrowser||{node,query:'',folder:''};
    const folders=[...new Set(this.assets.map(a=>a.folder).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const filtered=this.assets.filter(a=>(!state.folder||a.folder===state.folder)&&(!state.query||(a.name+' '+a.mime+' '+(a.folder||'')).toLocaleLowerCase('pt-BR').includes(state.query))&&(!state.node||a.mime?.startsWith('image/')));
    const rows=filtered.map(a=>{
      let thumb='<span>'+iconMarkup('Frame')+'</span>';
      if(a.mime?.startsWith('image/')){try{thumb='<img src="'+this.assetUrl(a)+'" alt="">';}catch{thumb='<span>'+iconMarkup('ImageLabel')+'</span>';}}
      else if(a.mime?.startsWith('video/'))thumb='<span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg></span>';
      else if(a.mime?.startsWith('audio/'))thumb='<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>';
      const use=node?'<button class="btn primary" data-library-use="'+esc(a.id)+'">Usar</button>':'';
      return '<article class="browser-file-row"><div class="browser-file-thumb">'+thumb+'</div><button class="browser-file-info" data-library-preview="'+esc(a.id)+'"><strong>'+esc(a.name)+'</strong><small>'+esc(a.folder||'Sem pasta')+' · '+this.formatBytes(a.size||0)+'</small></button><div class="browser-file-actions">'+use+'<button class="btn" data-library-rename="'+esc(a.id)+'" aria-label="Renomear arquivo">Renomear</button><button class="btn" data-library-download="'+esc(a.id)+'" aria-label="Baixar arquivo">Baixar</button><button class="btn danger" data-library-delete="'+esc(a.id)+'" aria-label="Excluir arquivo">Excluir</button></div></article>';
    }).join('');
    $('modal-content').classList.toggle('image-picker',!!node);
    $('modal-content').innerHTML='<header class="asset-browser-head"><div><h2>'+(node?'Selecionar imagem':'Biblioteca')+'</h2><p>'+(node?'Escolha uma imagem para o objeto selecionado.':'Biblioteca local do Flowiq Studio')+'</p></div><button class="icon-action" id="close-asset-browser" aria-label="Fechar biblioteca"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="asset-browser-tools"><input id="browser-asset-search" type="search" placeholder="Buscar por nome..." value="'+esc(state.query)+'"><select id="browser-asset-folder"><option value="">Todas as pastas</option>'+folders.map(f=>'<option value="'+esc(f)+'" '+(state.folder===f?'selected':'')+'>'+esc(f)+'</option>').join('')+'</select><button class="btn primary" id="browser-asset-upload">Adicionar arquivos</button></div><div class="asset-browser-path"><span>Biblioteca</span><span>›</span><strong>'+(state.folder?esc(state.folder):'Todos os arquivos')+'</strong><small>'+filtered.length+' itens</small></div><div class="asset-browser-list">'+(rows||'<div class="empty">'+(this.assets.length?'Nenhum arquivo corresponde a esta busca.': 'Nenhum arquivo ainda. Adicione imagens, vídeos ou outros recursos.')+'</div>')+'</div><p class="asset-browser-foot">Os arquivos permanecem neste navegador. Renomear não altera os objetos que já os utilizam.</p>';
    $('modal-content').classList.add('asset-browser-modal');
    $('close-asset-browser').onclick=()=>{this.assetBrowser=null;this.hideModal();};
    $('browser-asset-search').oninput=e=>{state.query=e.target.value.trim().toLocaleLowerCase('pt-BR');this.renderProjectLibraryBrowser(node);const input=$('browser-asset-search');input.focus();input.setSelectionRange(input.value.length,input.value.length);};
    $('browser-asset-folder').onchange=e=>{state.folder=e.target.value;this.renderProjectLibraryBrowser(node);};
    $('browser-asset-upload').onclick=()=>$('asset-file-input').click();
    this.enhanceSelects($('modal-content'));
    $('modal-content').querySelectorAll('[data-library-preview]').forEach(b=>b.onclick=()=>this.previewAsset(b.dataset.libraryPreview,true,node));
    $('modal-content').querySelectorAll('[data-library-use]').forEach(b=>b.onclick=()=>this.applyImageAsset(node,b.dataset.libraryUse));
    $('modal-content').querySelectorAll('[data-library-rename]').forEach(b=>b.onclick=async()=>{await this.renameAsset(b.dataset.libraryRename);if(this.assetBrowser)this.renderProjectLibraryBrowser(node);});
    $('modal-content').querySelectorAll('[data-library-download]').forEach(b=>b.onclick=()=>this.downloadAsset(b.dataset.libraryDownload));
    $('modal-content').querySelectorAll('[data-library-delete]').forEach(b=>b.onclick=async()=>{await this.deleteAsset(b.dataset.libraryDelete);if(this.assetBrowser)this.renderProjectLibraryBrowser(node);});
  }

  async renameAsset(id) {
    const asset=this.assets.find(a=>a.id===id);if(!asset)return;
    const name=(await this.askText('Renomear arquivo','Nome do arquivo',asset.name)).trim();
    if(!name||name===asset.name)return;
    try{await this.vfs.saveAsset({...asset,name:name.slice(0,180)});await this.refreshLibrary();if(this.selectedAssetId===id)this.renderLibrary();}
    catch(error){this.notify('Não foi possível renomear o arquivo: '+error.message);}
  }

  applyImageAsset(node,id) {
    if(!node||!this.model.find(node.id))return;
    this.pushHistory();node.properties.assetId=id;node.properties.imageUrl='';
    this.assetBrowser=null;this.hideModal();this.renderInspector();this.renderCanvas();this.scheduleSave();
  }

  async previewAsset(id,backToBrowser=false,node=null) {
    const asset=this.assets.find(a=>a.id===id);if(!asset)return;
    const url=this.assetUrl(asset),mime=asset.mime||'';
    let body='<div class="asset-preview-placeholder">Pré-visualização indisponível para este tipo de arquivo.</div>';
    if(mime.startsWith('image/'))body='<div class="asset-viewer-media"><img src="'+url+'" alt="'+esc(asset.name)+'"></div>';
    else if(mime.startsWith('video/'))body='<div class="asset-viewer-media"><video src="'+url+'" controls playsinline></video></div>';
    else if(mime.startsWith('audio/'))body='<div class="asset-viewer-audio">Áudio <audio src="'+url+'" controls></audio></div>';
    else if(mime==='application/pdf')body='<iframe class="asset-viewer-pdf" src="'+url+'" title="'+esc(asset.name)+'"></iframe>';
    else if(/(json|text|svg|xml)/i.test(mime)||/\.(json|svg|txt|xml)$/i.test(asset.name)){
      try{const raw=await asset.blob.text();body='<pre class="asset-viewer-text">'+esc(raw.slice(0,30000))+'</pre>';}catch{}
    }
    $('modal-content').innerHTML='<header class="asset-browser-head"><div><h2>'+esc(asset.name)+'</h2><p>'+esc(asset.mime||'Arquivo')+' · '+this.formatBytes(asset.size||0)+'</p></div><button class="icon-action" id="close-asset-preview" aria-label="Fechar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>'+body+'<div class="modal-actions asset-viewer-actions">'+(backToBrowser?'<button class="btn" id="back-asset-browser">Voltar aos arquivos</button>':'')+'<button class="btn" id="preview-asset-rename">Renomear</button><button class="btn primary" id="preview-asset-download">Baixar arquivo</button></div>';
    $('modal-content').classList.add('asset-browser-modal');
    $('close-asset-preview').onclick=()=>{if(backToBrowser)this.renderProjectLibraryBrowser(node);else this.hideModal();};
    $('preview-asset-download').onclick=()=>this.downloadAsset(id);
    $('preview-asset-rename').onclick=async()=>{await this.renameAsset(id);if(this.assets.find(a=>a.id===id))this.previewAsset(id,backToBrowser,node);};
    if(backToBrowser)$('back-asset-browser').onclick=()=>this.renderProjectLibraryBrowser(node);
  }

  downloadAsset(id) {
    const asset=this.assets.find(a=>a.id===id);if(!asset)return;
    const a=document.createElement('a');a.href=this.assetUrl(asset);a.download=asset.name||'flowiq-asset';a.rel='noopener';a.click();
  }
  assetUrl(asset) {
    if(!(asset?.blob instanceof Blob))throw new Error('O conteúdo deste arquivo não está disponível no armazenamento local.');
    if(!this.assetUrls.has(asset.id))this.assetUrls.set(asset.id,URL.createObjectURL(asset.blob));
    return this.assetUrls.get(asset.id);
  }

  async uploadAssets(fileList) {
    const files=[...(fileList||[])]; if(!files.length)return;
    const folder=$('asset-folder-name').value.trim().slice(0,48),button=$('asset-upload-button');
    button.disabled=true;let accepted=[],errors=[];
    try {
      for(const file of files) {
        if(!file.size){errors.push(file.name+': arquivo vazio');continue;}
        if(file.size>12*1024*1024){errors.push(file.name+': limite de 12 MB por arquivo');continue;}
        if(!(/^(image|video|audio|font)\//i.test(file.type)||/\.(woff2?|ttf|otf|pdf|json|svg)$/i.test(file.name))){errors.push(file.name+': tipo não permitido');continue;}
        accepted.push({id:this.makeId(),name:file.name,mime:file.type||'application/octet-stream',blob:file,folder});
      }
      if(accepted.length)await this.vfs.saveAssets(accepted);
      await this.refreshLibrary();
      if(accepted.length)this.selectedAssetId=accepted[0].id;
      this.renderLibrary();
      if(this.assetBrowser)this.renderProjectLibraryBrowser(this.assetBrowser.node);
      this.notify(accepted.length+' arquivo(s) adicionado(s).'+(errors.length?' Não adicionados: '+errors.join('; '):''),errors.length?'warning':'success');
    }catch(error){this.notify('Falha ao adicionar arquivos: '+error.message+' Nenhum arquivo do lote foi salvo.','error');}
    finally{button.disabled=false;$('asset-file-input').value='';}
  }


  async moveAsset(id) {
    const asset=this.assets.find(a=>a.id===id);if(!asset)return;
    const folder=(await this.askText('Organizar arquivo','Nome da pasta (deixe vazio para remover)',asset.folder||'')).trim().slice(0,48);
    if(folder===(asset.folder||''))return;
    try{await this.vfs.saveAsset({...asset,folder});await this.refreshLibrary();if(this.selectedAssetId===id)this.renderLibrary();this.notify('Arquivo movido para '+(folder||'Sem pasta')+'.','success');}
    catch(error){this.notify('Não foi possível mover o arquivo: '+error.message,'error');}
  }

  async deleteAsset(id) {
    const asset=this.assets.find(a=>a.id===id);if(!asset)return;
    const references=[];
    const scan=(nodes,projectName)=>{for(const node of nodes||[]){if(node?.properties?.assetId===id)references.push(projectName);scan(node?.children,projectName);}};
    for(const project of this.projects)scan(project.data,project.name);
    if(this.project)scan(this.model.toJSON(),this.project.name);
    if(references.length){this.notify('Este arquivo está em uso por '+references.length+' objeto(s). Remova a referência antes de excluir.','warning');return;}
    if(!await this.askConfirm('Excluir arquivo','Excluir "'+asset.name+'"? Esta ação não pode ser desfeita.','Excluir'))return;
    try { await this.vfs.deleteAsset(id);const url=this.assetUrls.get(id);if(url)URL.revokeObjectURL(url);this.assetUrls.delete(id);await this.refreshLibrary(); }
    catch(error){this.notify('Não foi possível excluir o arquivo: '+error.message);}
  }
  createProject() {
    $('modal-content').innerHTML = `<h2>Novo projeto</h2><div class="field"><label>Nome do projeto</label><input id="new-name" maxlength="48" value="Meu Sistema OS" placeholder="Ex.: NeoOS"></div><div class="modal-actions"><button class="btn" id="cancel-modal">Cancelar</button><button class="btn primary" id="confirm-create">Criar projeto</button></div>`;
    $('modal').classList.add('open');
    $('cancel-modal').onclick = () => this.hideModal();
    $('confirm-create').onclick = async () => {
      const name = $('new-name').value.trim();
      if (!name) { $('new-name').focus(); return; }
      const frame = new Instance('Frame', 'JanelaPrincipal');
      Object.assign(frame.properties, {width:320,height:420,positionX:24,positionY:24});
      const title = new Instance('TextLabel', 'Titulo');
      Object.assign(title.properties, {text:'Bem-vindo ao ' + name,positionX:18,positionY:18,width:280,height:36,fontSize:18});
      title.setParent(frame);
      const button = new Instance('TextButton', 'BotaoAcao');
      Object.assign(button.properties, {text:'Começar',positionX:85,positionY:90,width:150});
      button.setParent(frame);
      const p = createProjectRecord({id:this.makeId(),name,data:[frame.toJSON()]});
      try { await this.vfs.saveProject(p); this.hideModal(); await this.openProject(p.id); }
      catch (e) { this.log('Erro ao criar projeto: '+e.message,'error'); }
    };
    $('new-name').focus();
  }

  makeId() { return globalThis.crypto?.randomUUID?.() || 'proj_'+Date.now()+'_'+Math.random().toString(36).slice(2); }
  hideModal() {
    $('modal').classList.remove('open');
    $('modal-content').classList.remove('asset-browser-modal');
    this.assetBrowser=null;
    if(this.modalResolve){const resolve=this.modalResolve;this.modalResolve=null;resolve(null);}
  }

  askText(title,label,value='',placeholder=''){
    $('modal-content').classList.remove('asset-browser-modal');
    return new Promise(resolve=>{
      this.modalResolve=resolve;
      $('modal-content').innerHTML='<h2>'+esc(title)+'</h2><div class="field"><label>'+esc(label)+'</label><input id="studio-dialog-input" maxlength="64" value="'+esc(value)+'" placeholder="'+esc(placeholder)+'" autocomplete="off" autocapitalize="sentences"></div><div class="modal-actions"><button class="btn" id="studio-dialog-cancel">Cancelar</button><button class="btn primary" id="studio-dialog-ok">Confirmar</button></div>';
      $('modal').classList.add('open');
      const input=$('studio-dialog-input');
      const finish=result=>{if(this.modalResolve!==resolve)return;this.modalResolve=null;$('modal').classList.remove('open');resolve(result);};
      $('studio-dialog-cancel').onclick=()=>finish(null);
      $('studio-dialog-ok').onclick=()=>finish(input.value);
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finish(input.value);}});
      requestAnimationFrame(()=>{input.focus();input.select();});
    });
  }

  askChoice(title,label,options){
    return new Promise(resolve=>{
      this.modalResolve=resolve;
      const optionMarkup=options.map(option=>'<option value="'+esc(option.value)+'">'+esc(option.label)+'</option>').join('');
      $('modal-content').innerHTML='<h2>'+esc(title)+'</h2><div class="field"><label>'+esc(label)+'</label><select id="studio-dialog-choice">'+optionMarkup+'</select></div><div class="modal-actions"><button class="btn" id="studio-dialog-cancel">Cancelar</button><button class="btn primary" id="studio-dialog-ok">Mover</button></div>';
      $('modal').classList.add('open');
      const select=$('studio-dialog-choice');
      const finish=result=>{if(this.modalResolve!==resolve)return;this.modalResolve=null;$('modal').classList.remove('open');resolve(result);};
      $('studio-dialog-cancel').onclick=()=>finish(null);
      $('studio-dialog-ok').onclick=()=>finish(select.value);
      this.enhanceSelects($('modal-content'));
      requestAnimationFrame(()=>select.focus());
    });
  }

  askConfirm(title,message,confirmLabel='Confirmar'){
    return new Promise(resolve=>{
      this.modalResolve=resolve;
      $('modal-content').innerHTML='<h2>'+esc(title)+'</h2><p class="dialog-message">'+esc(message)+'</p><div class="modal-actions"><button class="btn" id="studio-dialog-cancel">Cancelar</button><button class="btn danger" id="studio-dialog-ok">'+esc(confirmLabel)+'</button></div>';
      $('modal').classList.add('open');
      const finish=result=>{if(this.modalResolve!==resolve)return;this.modalResolve=null;$('modal').classList.remove('open');resolve(result);};
      $('studio-dialog-cancel').onclick=()=>finish(false);
      $('studio-dialog-ok').onclick=()=>finish(true);
    });
  }

  async renameProject(id) {
    const project=this.projects.find(p=>p.id===id);if(!project)return;
    const name=(await this.askText('Renomear projeto','Nome do projeto',project.name)).trim();
    if(!name||name===project.name)return;
    try{project.name=name.slice(0,64);await this.vfs.saveProject(project);if(this.project?.id===id){this.project.name=project.name;$('project-title').textContent=project.name;this.renderTree();await this.save();}await this.loadHub();}
    catch(error){this.notify('Não foi possível renomear o projeto: '+error.message);}
  }

  async deleteProject(id) {
    const p = this.projects.find(x => x.id === id);
    if (!p || !await this.askConfirm('Excluir projeto','Excluir permanentemente "'+p.name+'"?','Excluir')) return;
    try { await this.vfs.deleteProject(id); await this.loadHub(); }
    catch (e) { this.log('Erro ao excluir: '+e.message,'error'); }
  }

  async openProject(id) {
    if(this.openingProject)return;
    this.openingProject=true;
    const loading=$('project-loading');
    const loadingStarted=Date.now();
    loading?.classList.add('show');
    try {
      // Prepare the project while the Home screen remains active. The editor is
      // revealed only after the loading layer has been visible for its full delay.
      const p = await this.vfs.getProject(id);
      if (!p) throw new Error('Projeto não encontrado.');
      this.project = normalizeProject(p);
      this.model.loadFromJSON(this.project.data || []);
      this.selected = null;
      this.expandedNodes = new Set(this.model.getAll().filter(n => n.children.length).map(n => n.id));
      this.treeQuery = '';
      this.treeDragId = null;
      $('tree-search').value = '';
      this.undoStack = []; this.redoStack = [];
      this.playMode = false;
      $('btn-save').disabled = false; $('btn-export').disabled = false;
      $('project-title').textContent = p.name;
      document.querySelectorAll('[data-workspace-nav]').forEach(item=>item.classList.toggle('active',item.dataset.workspaceNav==='editor'));
      this.closePanels(); this.refresh(); this.applyPreferences();
      const remaining=Math.max(0,2200-(Date.now()-loadingStarted));
      if(remaining)await new Promise(resolve=>setTimeout(resolve,remaining));
      $('hub').classList.remove('active');
      $('workspace').classList.add('active');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    } catch (e) {
      this.project=null;
      this.notify('Não foi possível abrir o projeto: '+(e?.message||'erro desconhecido'));
    } finally {
      loading?.classList.remove('show');
      this.openingProject=false;
    }
  }

  async leaveProject() {
    if(!this.project)return this.toHub();
    const choice=await new Promise(resolve=>{
      this.modalResolve=resolve;
      $('modal-content').innerHTML='<div class="leave-dialog"><h2>Voltar à tela inicial?</h2><p class="dialog-message">Deseja salvar as alterações deste projeto antes de sair?</p><div class="modal-actions leave-dialog-actions"><button class="btn primary" id="leave-save">Salvar e voltar</button><button class="btn danger" id="leave-discard">Sair sem salvar</button><button class="btn" id="leave-cancel">Continuar editando</button></div></div>';
      $('modal').classList.add('open');
      const finish=value=>{if(this.modalResolve!==resolve)return;this.modalResolve=null;$('modal').classList.remove('open');resolve(value);};
      $('leave-cancel').onclick=()=>finish('cancel');
      $('leave-discard').onclick=()=>finish('discard');
      $('leave-save').onclick=()=>finish('save');
    });
    if(choice==='cancel')return;
    clearTimeout(this.saveTimer);
    if(choice==='save')await this.save();
    else if(this.savePromise)await this.savePromise;
    await this.toHub();
  }

  async toHub() {
    this.focusMode=false;
    $('workspace').classList.remove('focus-mode');
    const focusButton=$('btn-focus-stage');if(focusButton)focusButton.setAttribute('aria-pressed','false');
    this.runtime.stop(); this.model = this.runtime.model;
    this.project = null; this.selected = null; this.playMode = false;
    $('workspace').classList.remove('active'); $('library-screen').classList.remove('active'); $('hub').classList.add('active');
    $('btn-save').disabled = true; $('btn-export').disabled = true;
    this.closePanels(); await this.loadHub(); this.showHubView('home');
  }

  async save() {
    if (!this.project) return;
    clearTimeout(this.saveTimer);
    if (this.savePromise) {
      this.savePending = true;
      return this.savePromise;
    }
    this.saving = true;
    const task = (async () => {
      try {
        do {
          this.savePending = false;
          const sourceModel = this.playMode ? this.runtime.editorModel : this.model;
          this.project.data = (sourceModel || this.model).toJSON();
          this.project.schemaVersion = 2;
          this.project.updatedAt = new Date().toISOString();
          await this.vfs.saveProject(this.project);
        } while (this.savePending);
        $('btn-save').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
        $('btn-save').title = 'Salvo'; $('btn-save').setAttribute('aria-label','Salvo');
        clearTimeout(this.saveFeedbackTimer);
        this.saveFeedbackTimer = setTimeout(() => {
          const button = $('btn-save');
          if (button) {
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l3 3v13H4V4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>';
            button.title = 'Salvar'; button.setAttribute('aria-label','Salvar');
          }
        }, 1200);
      } catch (e) {
        this.log('Erro ao salvar: '+e.message,'error');
      } finally {
        this.saving = false;
        this.savePromise = null;
        if (this.savePending) {
          this.savePending = false;
          this.scheduleSave();
        }
      }
    })();
    this.savePromise = task;
    return task;
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 650);
  }

  add(type) {
    if (!this.project || this.playMode) return;
    this.pushHistory();
    const parent = this.selected || this.model.root;
    const count = this.model.getAll().filter(n => n.className === type).length;
    const node = new Instance(type, type + '_' + (count+1));
    node.properties.positionX = 18 + (count%5)*12;
    node.properties.positionY = 18 + (count%5)*12;
    node.setParent(parent);
    if(parent!==this.model.root)this.expandedNodes.add(parent.id);
    this.select(node);
    this.focusNode(node);
    this.closeInstanceLibrary();
    this.scheduleSave();
  }

  select(node) {
    this.selected = node;
    for (let parent=node?.parent; parent && parent!==this.model.root; parent=parent.parent) this.expandedNodes.add(parent.id);
    this.refresh();
  }

  isMobile() { return window.matchMedia('(max-width: 820px)').matches; }

  toggleDesktopPanel(which) {
    if(this.isMobile()) return;
    const layout=$('workspace').querySelector('.editor-layout');
    const key=which==='explorer'?'explorer-collapsed':'inspector-collapsed';
    const hidden=layout.classList.toggle(key);
    $('show-'+which)?.setAttribute('aria-pressed',String(!hidden));
    requestAnimationFrame(()=>{this.renderSelectionHandles();this.updateRotateHandlePlacement();});
  }


  focusNode(node) {
    this.closePanels();
    requestAnimationFrame(() => {
      const area=$('stage-scroll');
      const el=[...$('canvas').querySelectorAll('[data-node-id]')].find(item=>item.dataset.nodeId===node?.id);
      if(!area||!el)return;
      const a=area.getBoundingClientRect(),r=el.getBoundingClientRect();
      area.scrollBy({left:(r.left+r.width/2)-(a.left+a.width/2),top:(r.top+r.height/2)-(a.top+a.height/2),behavior:'smooth'});
    });
  }

  setZoom(value) {
    this.zoom = Math.min(1.8, Math.max(0.4, Math.round(value * 10) / 10));
    const canvas = $('canvas');
    canvas.style.zoom = String(this.zoom);
    $('zoom-level').textContent = Math.round(this.zoom * 100) + '%';
    this.renderSelectionHandles();
  }

  fitCanvas() {
    const area = $('stage-scroll'), canvas = $('canvas');
    const available = Math.max(240, area.clientWidth - 24);
    this.setZoom(Math.min(1, available / Math.max(1, canvas.offsetWidth)));
    area.scrollTo({left:0,top:0,behavior:'smooth'});
  }

  duplicateSelected() {
    const source = this.selected;
    if (!source || !source.parent || this.playMode) return;
    this.pushHistory();
    const idMap = new Map();
    const cloneTree = (original, parent, isRoot = false) => {
      const copy = new Instance(original.className, original.name + '_copia');
      idMap.set(original.id, copy.id);
      Object.assign(copy.properties, JSON.parse(JSON.stringify(original.properties)));
      if (isRoot) {
        copy.properties.positionX = (Number(copy.properties.positionX) || 0) + 16;
        copy.properties.positionY = (Number(copy.properties.positionY) || 0) + 16;
      }
      copy.setParent(parent);
      original.children.forEach(child => cloneTree(child, copy));
      return copy;
    };
    const copy = cloneTree(source, source.parent, true);
    if (Array.isArray(this.project?.events)) {
      const copiedEvents = this.project.events
        .filter(event => idMap.has(event?.nodeId))
        .map(event => ({
          ...JSON.parse(JSON.stringify(event)),
          id: this.makeId(),
          nodeId: idMap.get(event.nodeId),
          actions: (Array.isArray(event.actions) ? event.actions : []).map(action => ({
            ...action,
            ...(idMap.has(action?.targetId) ? { targetId: idMap.get(action.targetId) } : {})
          }))
        }));
      this.project.events.push(...copiedEvents);
    }
    this.select(copy);
    this.focusNode(copy);
    this.scheduleSave();
    this.log(source.name + ' duplicado.', 'ok');
  }
  refresh() { this.renderTree(); this.renderCanvas(); this.renderInspector(); this.updateHistoryButtons(); }

  renderTree() {
    const root=$('tree');root.replaceChildren();
    const query=this.treeQuery||'',all=this.model.getAll(),matching=new Set();
    if(query)all.forEach(node=>{if((node.name+' '+node.className).toLocaleLowerCase('pt-BR').includes(query)){for(let cur=node;cur&&cur!==this.model.root;cur=cur.parent)matching.add(cur.id);}});
    const makeRow=(node,depth,isRoot=false)=>{
      const children=isRoot?this.model.root.children:node.children,id=isRoot?'project-root':node.id,expanded=isRoot||query||this.expandedNodes.has(id);
      const row=document.createElement('div');row.className='tree-row'+(!isRoot&&this.selected===node?' selected':'');
      row.style.paddingLeft=(5+depth*13)+'px';row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+1));row.setAttribute('aria-expanded',String(children.length>0&&!!expanded));
      if(!isRoot)row.setAttribute('aria-selected',String(this.selected===node));
      row.draggable=!isRoot;
      const disclosure=document.createElement('button');disclosure.type='button';disclosure.className='tree-disclosure'+(children.length?'':' spacer');disclosure.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
      disclosure.setAttribute('aria-label',(expanded?'Recolher ':'Expandir ')+(isRoot?'Projeto':node.name));
      disclosure.onclick=event=>{event.stopPropagation();if(isRoot)return;if(this.expandedNodes.has(id))this.expandedNodes.delete(id);else this.expandedNodes.add(id);this.renderTree();};row.append(disclosure);
      const type=document.createElement('span');type.className='tree-type-icon'+(isRoot?' project-type-icon':'');type.innerHTML=iconMarkup(isRoot?'Project':node.className);type.title=isRoot?'Projeto':node.className;row.append(type);
      const name=document.createElement('span');name.className='node-name';name.textContent=isRoot?(this.project?.name||'Projeto'):node.name;row.append(name);
      if(children.length){const count=document.createElement('span');count.className='tree-count';count.textContent=String(children.length);row.append(count);}
      const menu=document.createElement('button');menu.type='button';menu.className='tree-menu-trigger';menu.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';menu.title='Ações do objeto';menu.setAttribute('aria-label','Ações de '+(isRoot?'Projeto':node.name));menu.onclick=e=>{e.stopPropagation();this.showTreeMenu(node,menu,isRoot);};row.append(menu);
      if(!isRoot)row.onclick=()=>this.select(node);
      row.addEventListener('dragstart',e=>{if(isRoot)return;this.treeDragId=node.id;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',node.id);});
      row.addEventListener('dragend',()=>{this.treeDragId=null;root.querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'));});
      row.addEventListener('dragover',e=>{const targetParent=node;if(!targetParent||!this.treeDragId||this.treeDragId===node.id)return;e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('drop-target');});
      row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));
      row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('drop-target');const dragged=this.model.find(e.dataTransfer.getData('text/plain')||this.treeDragId);const parent=isRoot?this.model.root:node;if(dragged&&parent)this.reparentNode(dragged,parent);});
      root.append(row);
      if(expanded)children.forEach(child=>{if(!query||matching.has(child.id))makeRow(child,depth+1,false);});
    };
    makeRow(this.model.root,0,true);
    if(query&&!matching.size)root.innerHTML='<p class="muted" style="font-size:11px;padding:10px">Nenhum objeto encontrado.</p>';
    else if(!all.length)root.innerHTML='<p class="muted" style="font-size:11px;padding:10px">O projeto está vazio. Adicione um Frame para começar.</p>';
    const target=this.selected;
    $('instance-parent-label').textContent='Adicionar em '+(target?target.name:(this.project?.name||'Projeto'));
  }

  toggleInstanceLibrary(){const panel=$('instance-library');panel.hidden=!panel.hidden;if(!panel.hidden){$('instance-parent-label').textContent='Adicionar em '+(this.selected?.name||this.project?.name||'Projeto');}}
  closeInstanceLibrary(){$('instance-library').hidden=true;}
  closeTreeMenu(){this.treeMenu?.remove();this.treeMenu=null;}
  showTreeMenu(node,anchor,isRoot=false){
    this.closeTreeMenu();
    const menu=document.createElement('div');menu.className='tree-context-menu';menu.setAttribute('role','menu');
    const add=(label,action,extra='')=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.className=extra;button.onclick=()=>{this.closeTreeMenu();action();};menu.append(button);};
    const sep=()=>{const line=document.createElement('div');line.className='menu-separator';menu.append(line);};
    if(isRoot){add('Renomear projeto',()=>this.renameProject(this.project.id));sep();add('Expandir tudo',()=>{this.model.getAll().forEach(n=>{if(n.children.length)this.expandedNodes.add(n.id);});this.renderTree();});add('Recolher tudo',()=>{this.expandedNodes.clear();this.renderTree();});}
    else{
      add('Selecionar',()=>this.select(node));
      add('＋ Inserir instância filha',()=>{this.select(node);this.toggleInstanceLibrary();});
      add('Renomear  ·  F2',()=>this.renameNode(node));
      add('Duplicar  ·  Ctrl+D',()=>{this.select(node);this.duplicateSelected();});
      sep();
      add('Mover para outro Frame…',()=>this.moveIntoFrame(node));
      add('Mover para raiz',()=>this.reparentNode(node,this.model.root));
      add('Mover para cima',()=>this.reorderNode(node,-1));
      add('Mover para baixo',()=>this.reorderNode(node,1));
      sep();
      add('Excluir  ·  Delete',()=>{this.select(node);this.deleteSelected();},'danger');
    }
    document.body.append(menu);this.treeMenu=menu;
    const r=anchor.getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;
    menu.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.right-w))+'px';
    menu.style.top=Math.max(8,Math.min(window.innerHeight-h-8,r.bottom+3))+'px';
  }
  async renameNode(node){
    const value=await this.askText('Renomear objeto','Nome do objeto',node.name,'Novo nome');
    if(value===null)return;
    const name=value.trim().slice(0,64);if(!name)return;
    this.pushHistory();node.name=name;this.refresh();this.scheduleSave();
  }
  async moveIntoFrame(node){
    const targets=[this.model.root,...this.model.getAll().filter(candidate=>candidate!==node&&!this.isDescendant(candidate,node))];
    const selected=await this.askChoice('Mover objeto','Escolha o destino',targets.map((target,index)=>({value:String(index),label:(target===this.model.root?'Projeto':target.name+' ('+target.className+')')})));
    if(selected===null)return;
    const target=targets[Number(selected)];
    if(target)this.reparentNode(node,target);
  }
  isDescendant(candidate,ancestor){
    for(let current=candidate?.parent;current;current=current.parent)if(current===ancestor)return true;
    return false;
  }
  reparentNode(node,parent){
    if(!node||!parent||node===parent||node.parent===parent||this.playMode)return;
    try{this.pushHistory();node.setParent(parent);if(parent!==this.model.root)this.expandedNodes.add(parent.id);this.select(node);this.scheduleSave();this.log(node.name+' movido na hierarquia.','ok');}
    catch(error){this.log('Não foi possível mover: '+error.message,'error');}
  }
  reorderNode(node,direction){
    if(!node?.parent)return;const siblings=node.parent.children,index=siblings.indexOf(node),next=index+direction;
    if(next<0||next>=siblings.length)return;
    this.pushHistory();[siblings[index],siblings[next]]=[siblings[next],siblings[index]];this.renderTree();this.scheduleSave();
  }

  renderCanvas() {
    const canvas = $(this.playMode?'preview-canvas':'canvas'); if(!canvas)return; canvas.replaceChildren();
    const renderNode = (node, parentEl) => {
      if (node.properties.visible === false) return;
      const p = node.properties;
      const el = document.createElement(node.className === 'TextButton' && this.playMode ? 'button' : 'div');
      el.className = 'node'+(this.selected === node && !this.playMode ? ' selected':'')+(node.className === 'TextButton'?' button-node':'');
      el.dataset.nodeId = node.id;
      el.style.left = (Number(p.positionX)||0)+'px'; el.style.top = (Number(p.positionY)||0)+'px';
      el.style.width = Math.max(1,Number(p.width)||1)+'px'; el.style.height = Math.max(1,Number(p.height)||1)+'px';
      el.style.background = p.backgroundColor || 'transparent'; el.style.color = p.textColor || '#fff';
      el.style.borderRadius = Math.max(0,Number(p.borderRadius)||0)+'px';
      el.style.fontSize = Math.max(8,Number(p.fontSize)||14)+'px';
      el.style.opacity = String(Math.min(1,Math.max(0,Number(p.opacity??1))));
      el.style.border = Number(p.borderWidth)>0 ? Math.min(12,Number(p.borderWidth))+'px solid '+(p.borderColor||'#64748b') : node.className === 'TextButton' ? '1px solid #ffffff30' : 'none';
      el.style.fontWeight = p.fontWeight==='bold'?'700':'400';
      el.style.textAlign = p.textAlign || 'center';
      if(node.className==='ImageLabel'){
        const asset=this.assets.find(item=>item.id===p.assetId);
        const source=asset?this.assetUrl(asset):(/^https?:\/\//i.test(String(p.imageUrl||''))?String(p.imageUrl):'');
        if(source){
          el.style.backgroundImage='url("'+source.replace(/["\\]/g,'')+'")';
          el.style.backgroundSize=p.imageFit==='contain'?'contain':'cover';
          el.style.backgroundPosition='center';
          el.style.backgroundRepeat='no-repeat';
        }
      }
      el.style.position = 'absolute';
      el.style.transform = 'rotate('+(Number(p.rotation)||0)+'deg)';
      el.style.transformOrigin = 'center center';
      if (node.className === 'Frame') { el.style.display='block'; el.style.overflow='visible'; el.style.outlineOffset='2px'; }
      el.textContent = p.text || (node.className === 'Frame' || (node.className==='ImageLabel'&&p.imageUrl) ? '' : node.name);
      if (node.className === 'TextButton' && this.playMode) {
        el.type = 'button'; el.onclick = () => this.runtime.dispatch(node,'click',{ source:'pointer' });
      } else if (!this.playMode) {
        el.onclick = (e) => { e.stopPropagation(); };
      }
      parentEl.append(el);
      node.children.forEach(child => renderNode(child,el));
    };
    this.model.root.children.forEach(node => renderNode(node,canvas));
    if (!canvas.children.length) canvas.innerHTML = '<div class="empty-canvas">Seu palco está vazio.<br>Adicione um Frame para começar.</div>';
    if(!this.playMode)this.renderSelectionHandles();
  }

  getParentRotation(node) {
    let rotation = 0;
    for (let parent = node?.parent; parent && parent !== this.model.root; parent = parent.parent) {
      rotation += Number(parent.properties.rotation) || 0;
    }
    return rotation;
  }

  getWorldRotation(node) {
    return this.getParentRotation(node) + (Number(node?.properties.rotation) || 0);
  }

  startDrag(event) {
    if (!this.project || this.playMode || event.button !== 0 || this.drag) return;
    const handle=event.target.closest('[data-resize]');
    const rotate=event.target.closest('[data-rotate]');
    const target=handle||rotate;
    const el=target?[...$('canvas').querySelectorAll('[data-node-id]')].find(item=>item.dataset.nodeId===target.dataset.nodeId):event.target.closest('[data-node-id]');
    if(!el)return;
    const node=this.model.find(el.dataset.nodeId);if(!node)return;
    const wasSelected=this.selected===node;
    if(!wasSelected){
      this.drag={node,el,pointerId:event.pointerId,mode:'select',tapEligible:!handle&&!rotate,startX:event.clientX,startY:event.clientY,moved:false};
      try{$('canvas').setPointerCapture(event.pointerId);}catch(_){}
      event.preventDefault();return;
    }
    const rect=el.getBoundingClientRect();
    const centerX=rect.left+rect.width/2,centerY=rect.top+rect.height/2;
    const startAngle=Math.atan2(event.clientY-centerY,event.clientX-centerX)*180/Math.PI;
    this.drag={
      node,el,pointerId:event.pointerId,tapEligible:!handle&&!rotate,
      mode:rotate?'rotate':handle?'resize':'move',direction:handle?.dataset.resize||'',
      startX:event.clientX,startY:event.clientY,
      baseX:Number(node.properties.positionX)||0,baseY:Number(node.properties.positionY)||0,
      baseW:Math.max(1,Number(node.properties.width)||1),baseH:Math.max(1,Number(node.properties.height)||1),
      baseRotation:Number(node.properties.rotation)||0,parentRotation:this.getParentRotation(node),startAngle,centerX,centerY,
      moved:false,historyRecorded:false,scaleX:this.zoom||1,scaleY:this.zoom||1,startRect:el.getBoundingClientRect()
    };
    try{$('canvas').setPointerCapture(event.pointerId);}catch(_){}
    event.preventDefault();
  }

  moveDrag(event) {
    const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;
    const distance=Math.hypot(event.clientX-d.startX,event.clientY-d.startY);
    if(d.mode==='select'){if(distance>10)d.moved=true;return;}
    if(!d.moved&&distance<8)return;
    if(!d.moved){d.moved=true;d.historyRecorded=false;}
    if(!d.historyRecorded){this.pushHistory();d.historyRecorded=true;}
    let screenDX=event.clientX-d.startX,screenDY=event.clientY-d.startY;
    if(d.mode==='move'){
      if(this.smartAlign&&!event.altKey){const aligned=this.getSmartAlignment(d,screenDX,screenDY);screenDX=aligned.dx;screenDY=aligned.dy;this.renderAlignmentGuides(aligned.guides);}else this.clearAlignmentGuides();
    }
    let dx=screenDX/(d.scaleX||1),dy=screenDY/(d.scaleY||1);
    const p=d.node.properties;
    if(d.mode==='resize'){
      const a=-(d.parentRotation+d.baseRotation)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
      const localX=dx*c-dy*s,localY=dx*s+dy*c;dx=localX;dy=localY;
    }else if(d.mode==='move'){
      const a=-d.parentRotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
      const localX=dx*c-dy*s,localY=dx*s+dy*c;dx=localX;dy=localY;
    }
    if(d.mode==='rotate'){
      const angle=Math.atan2(event.clientY-d.centerY,event.clientX-d.centerX)*180/Math.PI;
      const rawRotation=((d.baseRotation+angle-d.startAngle)%360+360)%360;
      p.rotation=event.shiftKey?Math.round(rawRotation/15)*15:Math.round(rawRotation);
      p.rotation=((p.rotation%360)+360)%360;
      d.el.style.transform='rotate('+p.rotation+'deg)';
    }else if(d.mode==='resize'){
      const dir=d.direction;
      const oldW=d.baseW,oldH=d.baseH;
      let w=dir.includes('e')?Math.max(24,oldW+dx):dir.includes('w')?Math.max(24,oldW-dx):oldW;
      let h=dir.includes('s')?Math.max(24,oldH+dy):dir.includes('n')?Math.max(24,oldH-dy):oldH;
      if(this.smartAlign&&!event.altKey){const aligned=this.getSmartResize(d,w,h);w=aligned.w;h=aligned.h;this.renderAlignmentGuides(aligned.guides);}else this.clearAlignmentGuides();
      // Keep the opposite edge/corner fixed. The center moves by half the
      // size delta in the element's local axes, then is rotated into its parent.
      // The CSS layout origin also shifts by +delta/2 (old size minus new size).
      const deltaW=oldW-w,deltaH=oldH-h;
      const anchorLocalX=dir.includes('w')?deltaW/2:dir.includes('e')?-deltaW/2:0;
      const anchorLocalY=dir.includes('n')?deltaH/2:dir.includes('s')?-deltaH/2:0;
      const angle=(d.baseRotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      const centerShiftX=cos*anchorLocalX-sin*anchorLocalY;
      const centerShiftY=sin*anchorLocalX+cos*anchorLocalY;
      p.positionX=Math.round(d.baseX+centerShiftX+deltaW/2);
      p.positionY=Math.round(d.baseY+centerShiftY+deltaH/2);
      p.width=Math.round(w);p.height=Math.round(h);
      d.el.style.left=p.positionX+'px';d.el.style.top=p.positionY+'px';d.el.style.width=p.width+'px';d.el.style.height=p.height+'px';
      const width=$('p-w'),height=$('p-h'),px=$('p-x'),py=$('p-y');
      if(width)width.value=p.width;if(height)height.value=p.height;if(px)px.value=p.positionX;if(py)py.value=p.positionY;    }else{
      p.positionX=Math.round(d.baseX+dx);p.positionY=Math.round(d.baseY+dy);
      d.el.style.left=p.positionX+'px';d.el.style.top=p.positionY+'px';
      const x=$('p-x'),y=$('p-y');if(x)x.value=p.positionX;if(y)y.value=p.positionY;
    }
    this.updateSelectionHandles();
  }

  getAlignmentTargets(d){
    const canvas=$('canvas'),targets=[],seen=new Set();
    const add=(node,kind)=>{
      const el=node===this.model.root?canvas:[...canvas.querySelectorAll('[data-node-id]')].find(item=>item.dataset.nodeId===node.id);
      if(!el||node===d.node||d.node.getAll().includes(node)||seen.has(el))return;
      const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return;
      targets.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,kind});seen.add(el);
    };
    const parent=d.node.parent;
    if(parent){parent.children.filter(node=>node!==d.node).forEach(node=>add(node,'sibling'));
      for(let ancestor=parent;ancestor&&ancestor!==this.model.root;ancestor=ancestor.parent)add(ancestor,'parent');
      if(parent===this.model.root)add(this.model.root,'canvas');}
    return targets;
  }


  getSmartAlignment(d,screenDX,screenDY){
    const tolerance=8,m=d.startRect,targets=this.getAlignmentTargets(d);
    const movingX=[m.left+screenDX,m.left+m.width/2+screenDX,m.right+screenDX];
    const movingY=[m.top+screenDY,m.top+m.height/2+screenDY];
    movingY.push(m.bottom+screenDY);let bestX=null,bestY=null;
    for(const r of targets){const xs=[r.left,r.left+r.width/2,r.right],ys=[r.top,r.top+r.height/2,r.bottom];
      for(const x of movingX)for(const target of xs){const delta=target-x;if(Math.abs(delta)<=tolerance&&(!bestX||Math.abs(delta)<Math.abs(bestX.delta)))bestX={delta,target};}
      for(const y of movingY)for(const target of ys){const delta=target-y;if(Math.abs(delta)<=tolerance&&(!bestY||Math.abs(delta)<Math.abs(bestY.delta)))bestY={delta,target};}}
    if(bestX)screenDX+=bestX.delta;if(bestY)screenDY+=bestY.delta;
    return {dx:screenDX,dy:screenDY,guides:{x:bestX?.target??null,y:bestY?.target??null}};
  }

  getSmartResize(d,w,h){
    const tolerance=8,zoom=d.scaleX||1,m=d.startRect,dir=d.direction,targets=this.getAlignmentTargets(d);let guideX=null,guideY=null;
    if(dir.includes('e')||dir.includes('w')){const edge=dir.includes('e')?m.right+(w-d.baseW)*zoom:m.left-(w-d.baseW)*zoom;let best=null;
      for(const r of targets)for(const target of [r.left,r.left+r.width/2,r.right]){const delta=target-edge;if(Math.abs(delta)<=tolerance&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,target};}
      if(best){w=Math.max(24,w+(dir.includes('e')?best.delta:-best.delta)/zoom);guideX=best.target;}}
    if(dir.includes('n')||dir.includes('s')){const edge=dir.includes('s')?m.bottom+(h-d.baseH)*zoom:m.top-(h-d.baseH)*zoom;let best=null;
      for(const r of targets)for(const target of [r.top,r.top+r.height/2,r.bottom]){const delta=target-edge;if(Math.abs(delta)<=tolerance&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,target};}
      if(best){h=Math.max(24,h+(dir.includes('s')?best.delta:-best.delta)/zoom);guideY=best.target;}}
    return {w,h,guides:{x:guideX,y:guideY}};
  }
  renderAlignmentGuides(guides){
    const canvas=$('canvas');
    let layer=canvas.querySelector('.alignment-guides');
    if(!layer){layer=document.createElement('div');layer.className='alignment-guides';canvas.append(layer);}
    layer.replaceChildren();
    const rect=canvas.getBoundingClientRect(),zoom=this.zoom||1;
    if(guides.x!==null){const line=document.createElement('i');line.className='alignment-guide alignment-guide-x';line.style.left=((guides.x-rect.left)/zoom)+'px';layer.append(line);}
    if(guides.y!==null){const line=document.createElement('i');line.className='alignment-guide alignment-guide-y';line.style.top=((guides.y-rect.top)/zoom)+'px';layer.append(line);}
  }

  clearAlignmentGuides(){ $('canvas')?.querySelector('.alignment-guides')?.remove(); }

  endDrag(event) {
    const d=this.drag;
    if(!d||(event?.pointerId!==undefined&&event.pointerId!==d.pointerId))return;
    this.drag=null;
    this.clearAlignmentGuides();
    if(d.moved){
      if(d.mode!=='select'){this.renderSelectionHandles();this.scheduleSave();}
      return;
    }
    if(event?.type!=='pointerup')return;
    if(d.mode==='select')this.select(d.node);
    if(d.tapEligible===false)return;
    const now=Date.now(),last=this.lastTap;
    if(last&&last.id===d.node.id&&now-last.time<650){
      clearTimeout(this.lastTapTimer);
      this.lastTap=null;
      this.selected=d.node;
      this.refresh();
      this.openPanel('inspector');
    }else{
      this.lastTap={id:d.node.id,time:now};
      clearTimeout(this.lastTapTimer);
      this.lastTapTimer=setTimeout(()=>{this.lastTap=null;},700);
    }
  }

  positionSelectionOverlay(overlay,el){
    const canvas=$('canvas'),canvasRect=canvas.getBoundingClientRect(),objectRect=el.getBoundingClientRect();
    const scaleX=canvas.offsetWidth?canvasRect.width/canvas.offsetWidth:(this.zoom||1);
    const scaleY=canvas.offsetHeight?canvasRect.height/canvas.offsetHeight:(this.zoom||1);
    const width=Math.max(1,el.offsetWidth),height=Math.max(1,el.offsetHeight);
    const centerX=(objectRect.left+objectRect.width/2-canvasRect.left-canvas.clientLeft)/Math.max(.01,scaleX);
    const centerY=(objectRect.top+objectRect.height/2-canvasRect.top-canvas.clientTop)/Math.max(.01,scaleY);
    const rotation=this.getWorldRotation(this.model.find(el.dataset.nodeId));
    const handleScale=1/Math.max(.01,Math.min(scaleX,scaleY));
    overlay.style.left=(centerX-width/2)+'px';
    overlay.style.top=(centerY-height/2)+'px';
    overlay.style.width=width+'px';overlay.style.height=height+'px';
    overlay.style.transform='rotate('+rotation+'deg)';
    overlay.style.setProperty('--handle-scale',String(handleScale));
    overlay.dataset.rotation=String(rotation);
  }

  updateRotateHandlePlacement(){
    const canvas=$('canvas'),stage=$('stage-scroll');
    const overlay=canvas?.querySelector('.selection-box');
    const rotate=overlay?.querySelector('[data-rotate]');
    if(!rotate||!this.selected||!stage)return;
    const handleScale=Number.parseFloat(overlay.style.getPropertyValue('--handle-scale'))||1;
    const rotation=Number(overlay.dataset.rotation)||0;
    const canvasRect=canvas.getBoundingClientRect(),overlayRect=overlay.getBoundingClientRect(),stageRect=stage.getBoundingClientRect();
    const scaleX=canvas.offsetWidth?canvasRect.width/canvas.offsetWidth:(this.zoom||1);
    const scaleY=canvas.offsetHeight?canvasRect.height/canvas.offsetHeight:(this.zoom||1);
    const half=17*handleScale;
    const topSpace=overlayRect.top-stageRect.top;
    const bottomSpace=stageRect.bottom-overlayRect.bottom;
    const placeAbove=topSpace>=38*handleScale||topSpace>=bottomSpace;
    const centerX=overlayRect.left+overlayRect.width/2;
    const safeLeft=stageRect.left+half+8, safeRight=stageRect.right-half-8;
    const visibleX=Math.max(safeLeft,Math.min(safeRight,centerX));
    const canvasX=(visibleX-canvasRect.left-canvas.clientLeft)/Math.max(.01,scaleX);
    rotate.style.left=(canvasX-overlay.offsetLeft)+'px';
    rotate.style.top=placeAbove?(-22*handleScale)+'px':(overlay.offsetHeight+22*handleScale)+'px';
    rotate.style.transform='translate(-50%,-50%) rotate('+(-rotation)+'deg)';
  }

  renderSelectionHandles(){
    const canvas=$('canvas');canvas.querySelector('.selection-box')?.remove();
    if(!this.selected||this.playMode)return;
    const el=[...canvas.querySelectorAll('[data-node-id]')].find(item=>item.dataset.nodeId===this.selected.id);if(!el)return;
    const overlay=document.createElement('div');overlay.className='selection-box';
    this.positionSelectionOverlay(overlay,el);
    ['nw','n','ne','e','se','s','sw','w'].forEach(dir=>{const h=document.createElement('button');h.type='button';h.className='resize-handle';h.dataset.resize=dir;h.dataset.nodeId=this.selected.id;h.setAttribute('aria-label','Redimensionar '+dir);overlay.append(h);});
    const rotate=document.createElement('button');rotate.type='button';rotate.className='rotate-handle';rotate.dataset.rotate='true';rotate.dataset.nodeId=this.selected.id;rotate.setAttribute('aria-label','Rotacionar objeto');rotate.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8A8 8 0 1 1 4 14"/><path d="M4 3v5h5"/></svg>';overlay.append(rotate);
    canvas.append(overlay);
    this.updateRotateHandlePlacement();
  }

  updateSelectionHandles(){
    const overlay=$('canvas').querySelector('.selection-box');if(!overlay||!this.drag)return;
    this.positionSelectionOverlay(overlay,this.drag.el);
    this.updateRotateHandlePlacement();
  }

  pushHistory(){
    if(!this.project)return;
    this.undoStack.push({data:JSON.parse(JSON.stringify(this.model.toJSON())),events:JSON.parse(JSON.stringify(this.project.events||[])),selectedId:this.selected?.id||null});
    if(this.undoStack.length>80)this.undoStack.shift();this.redoStack.length=0;this.updateHistoryButtons();
  }
  restoreHistory(snapshot){this.model.loadFromJSON(snapshot.data);if(this.project&&Array.isArray(snapshot.events))this.project.events=JSON.parse(JSON.stringify(snapshot.events));this.selected=snapshot.selectedId?this.model.find(snapshot.selectedId):null;this.refresh();this.scheduleSave();}
  undo(){if(!this.undoStack.length)return;this.redoStack.push({data:JSON.parse(JSON.stringify(this.model.toJSON())),events:JSON.parse(JSON.stringify(this.project?.events||[])),selectedId:this.selected?.id||null});this.restoreHistory(this.undoStack.pop());}
  redo(){if(!this.redoStack.length)return;this.undoStack.push({data:JSON.parse(JSON.stringify(this.model.toJSON())),events:JSON.parse(JSON.stringify(this.project?.events||[])),selectedId:this.selected?.id||null});this.restoreHistory(this.redoStack.pop());}
  updateHistoryButtons(){const u=$('undo-action'),r=$('redo-action');if(u)u.disabled=!this.undoStack.length;if(r)r.disabled=!this.redoStack.length;}

  renderInspector(){
    const box=$('inspector-content'),node=this.selected;
    if(!node){box.innerHTML='<p class="muted">Selecione um objeto no Explorer ou no palco para editar suas propriedades.</p>';return;}
    const p=node.properties,isFrame=node.className==='Frame',isImage=node.className==='ImageLabel',isText=node.className==='TextButton'||node.className==='TextLabel';
    const field=(label,id,value,type='text',attrs='')=>type==='color'?'<div class="field"><label>'+label+'</label>'+this.colorControlMarkup(id,color(value,'#ffffff'))+'</div>':'<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" type="'+type+'" value="'+esc(value??'')+'" '+attrs+'></div>';
    const select=(label,id,value,options)=>'<div class="field"><label for="'+id+'">'+label+'</label><select id="'+id+'">'+options.map(([v,l])=>'<option value="'+v+'" '+(value===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div>';
    box.innerHTML=`
      <div class="properties-object-heading"><span class="tree-type-icon">${iconMarkup(node.className)}</span><div><strong>${esc(node.name)}</strong><small>${esc(node.className)}</small></div></div>
      <div class="field"><label for="p-name">Nome</label><input id="p-name" maxlength="64" value="${esc(node.name)}"></div>
      <details class="property-group" open><summary>Transformação</summary>
        <div class="field-grid">${field('Posição X','p-x',p.positionX??0,'number')}${field('Posição Y','p-y',p.positionY??0,'number')}${field('Largura','p-w',p.width??100,'number','min="1"')}${field('Altura','p-h',p.height??40,'number','min="1"')}${field('Rotação','p-rotation',p.rotation??0,'number')}</div>
      </details>
      <details class="property-group" open><summary>${isFrame?'Aparência do Frame':isImage?'Imagem':'Aparência e texto'}</summary>
        ${isImage?'<div class="field"><label>Imagem da biblioteca</label><button type="button" class="btn" id="choose-image-asset">'+(p.assetId?'Trocar imagem da biblioteca':'Selecionar da biblioteca')+'</button><small class="muted">'+esc(this.assets.find(a=>a.id===p.assetId)?.name||'Nenhuma imagem selecionada')+'</small><button type="button" class="btn" id="clear-image-asset" '+(!p.assetId?'disabled':'')+'>Remover imagem</button></div>'+field('URL da imagem (opcional)','p-image-url',p.imageUrl||'','url','placeholder="https://..."')+select('Ajuste da imagem','p-image-fit',p.imageFit||'cover',[['cover','Preencher'],['contain','Conter']]):''}
        ${isText?'<div class="field"><label for="p-text">Texto</label><textarea id="p-text" rows="3">'+esc(p.text||'')+'</textarea></div>'+field('Tamanho da fonte','p-font',p.fontSize??14,'number','min="8" max="96"')+select('Peso da fonte','p-weight',p.fontWeight||'normal',[['normal','Regular'],['bold','Negrito']])+select('Alinhamento','p-align',p.textAlign||'center',[['left','Esquerda'],['center','Centro'],['right','Direita']]):''}
        <div class="field-grid">${field('Cor de fundo','p-bg',color(p.backgroundColor,'#182235'),'color')}${isText?field('Cor do texto','p-fg',color(p.textColor,'#ffffff'),'color'):''}</div>
        <div class="field-grid">${field('Raio da borda','p-radius',p.borderRadius??8,'number','min="0" max="100"')}${field('Espessura da borda','p-border-width',p.borderWidth??0,'number','min="0" max="12"')}</div>
        ${field('Cor da borda','p-border-color',color(p.borderColor,'#64748b'),'color')}
        ${field('Opacidade (0 a 1)','p-opacity',p.opacity??1,'number','min="0" max="1" step="0.05"')}
      </details>
      <details class="property-group"><summary>Comportamento</summary>
        <label class="visibility-control"><input type="checkbox" id="p-visible" ${p.visible!==false?'checked':''}> Visível</label>
        ${isFrame?'<p class="muted" style="font-size:10px">Os objetos filhos acompanham a hierarquia deste Frame.</p>':''}
      </details>
      <details class="property-group event-editor-group" open>
        <summary>Interações</summary>
        <p class="event-editor-help">Crie comportamentos sem escrever código. Escolha o que dispara a ação e o que deve acontecer.</p>
        <div id="event-editor-content"></div>
      </details>
      <div class="inspector-actions"><button class="btn" id="duplicate-node"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5H5v11h3"/></svg> Duplicar</button><button class="btn danger" id="delete-node"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg> Excluir</button></div>`;
    const setters={
      'p-name':v=>{node.name=v;const title=box.querySelector('.properties-object-heading strong');if(title)title.textContent=v;this.renderTree();this.scheduleSave();},
      'p-x':v=>p.positionX=Number(v)||0,'p-y':v=>p.positionY=Number(v)||0,'p-w':v=>p.width=Math.max(1,Number(v)||1),'p-h':v=>p.height=Math.max(1,Number(v)||1),'p-rotation':v=>p.rotation=Number(v)||0,
      'p-bg':v=>p.backgroundColor=v,'p-radius':v=>p.borderRadius=Math.max(0,Number(v)||0),'p-border-width':v=>p.borderWidth=Math.min(12,Math.max(0,Number(v)||0)),
      'p-border-color':v=>p.borderColor=v,'p-opacity':v=>p.opacity=Math.min(1,Math.max(0,Number(v)||0)),
      'p-text':v=>p.text=v,'p-fg':v=>p.textColor=v,'p-font':v=>p.fontSize=Math.max(8,Number(v)||8),'p-weight':v=>p.fontWeight=v,'p-align':v=>p.textAlign=v,
      'p-image-url':v=>p.imageUrl=v,'p-image-fit':v=>p.imageFit=v
    };
    Object.entries(setters).forEach(([id,set])=>{const input=$(id);if(!input)return;input.onfocus=()=>this.pushHistory();input.oninput=e=>{set(e.target.value);this.renderCanvas();this.scheduleSave();};input.onchange=e=>{set(e.target.value);this.renderCanvas();this.scheduleSave();};});
    if(isImage){
      $('choose-image-asset').onclick=()=>this.chooseImageAsset(node);
      $('clear-image-asset').onclick=()=>{this.pushHistory();p.assetId='';this.renderInspector();this.renderCanvas();this.scheduleSave();};
    }
    $('p-visible').onfocus=()=>this.pushHistory();$('p-visible').onchange=e=>{p.visible=e.target.checked;this.renderCanvas();this.scheduleSave();};
    $('delete-node').onclick=()=>this.deleteSelected();$('duplicate-node').onclick=()=>this.duplicateSelected();
    this.renderEventEditor(node,box);
    this.bindColorControls(box,setters);
    this.enhanceSelects(box);
  }

  colorControlMarkup(id,value){
    const rgb=hexToRgb(value),hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
    return '<div class="studio-color-control" data-color-id="'+id+'" data-color-value="'+value+'"><button type="button" class="studio-color-trigger" data-color-toggle aria-label="Abrir seletor de cor"><span class="studio-color-swatch" style="--swatch:'+value+'"></span></button><code class="studio-color-value">'+value+'</code><div class="studio-color-popover" data-color-popover hidden><div class="color-square" data-color-square style="--hue-color:'+hsvToHex(hsv.h,1,1)+';--sat:'+(hsv.s*100)+'%;--val:'+((1-hsv.v)*100)+'%"></div><div class="color-hue-row"><span>Matiz</span><input data-color-hue type="range" min="0" max="359" value="'+Math.round(hsv.h)+'"></div><div class="color-palette">'+['#FFFFFF','#D9E2F0','#94A3B8','#475569','#111827','#000000','#F87171','#EF4444','#F97316','#F59E0B','#FDE047','#84CC16','#22C55E','#14B8A6','#06B6D4','#3B82F6','#6366F1','#8B5CF6','#D946EF','#EC4899','#A16207','#854D0E','#166534','#155E75'].map(c=>'<button type="button" data-color-preset="'+c+'" style="--swatch:'+c+'" aria-label="'+c+'"></button>').join('')+'</div><div class="color-values"><label>HEX<input data-color-hex maxlength="7" value="'+value+'" spellcheck="false"></label><label>Cor atual<input data-color-preview value="'+value+'" readonly></label></div><div class="color-rgb">'+['r','g','b'].map(key=>'<label>'+key.toUpperCase()+'<input data-color-rgb="'+key+'" type="number" min="0" max="255" value="'+rgb[key]+'"></label>').join('')+'</div></div></div>';
  }

  bindColorControls(root,setters={}){
    root.querySelectorAll('[data-color-id]').forEach(control=>{
      if(control.dataset.bound==='true')return;
      control.dataset.bound='true';
      const id=control.dataset.colorId,pop=control.querySelector('[data-color-popover]'),square=control.querySelector('[data-color-square]'),hue=control.querySelector('[data-color-hue]'),hex=control.querySelector('[data-color-hex]'),preview=control.querySelector('[data-color-preview]'),rgbInputs=[...control.querySelectorAll('[data-color-rgb]')],trigger=control.querySelector('[data-color-toggle]');
      let current=control.dataset.colorValue||'#FFFFFF',rgb=hexToRgb(current),hsv=rgbToHsv(rgb.r,rgb.g,rgb.b),historyStarted=false,dragging=false;
      const close=()=>{pop.hidden=true;pop.remove();trigger.setAttribute('aria-expanded','false');};
      const place=()=>{
        const r=trigger.getBoundingClientRect(),w=Math.min(300,window.innerWidth-24),h=Math.min(pop.scrollHeight||380,Math.floor(window.innerHeight*.7));
        const left=Math.max(12,Math.min(window.innerWidth-w-12,r.left));
        let top=r.bottom+8;
        if(top+h>window.innerHeight-12)top=r.top-h-8;
        top=Math.max(12,Math.min(window.innerHeight-h-12,top));
        pop.style.position='fixed';pop.style.width=w+'px';pop.style.maxHeight=Math.floor(window.innerHeight*.7)+'px';pop.style.left=left+'px';pop.style.top=top+'px';
      };
      const update=value=>{
        value=color(value,'#FFFFFF').toUpperCase();
        if(value!==current&&!historyStarted){this.pushHistory();historyStarted=true;}
        current=value;rgb=hexToRgb(value);hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
        control.dataset.colorValue=value;
        control.querySelector('.studio-color-swatch').style.setProperty('--swatch',value);
        control.querySelector('.studio-color-value').textContent=value;
        hex.value=value;preview.value=value;
        rgbInputs.forEach(input=>input.value=rgb[input.dataset.colorRgb]);
        hue.value=String(Math.round(hsv.h));
        square.style.setProperty('--hue-color',hsvToHex(hsv.h,1,1));
        square.style.setProperty('--sat',(hsv.s*100)+'%');
        square.style.setProperty('--val',((1-hsv.v)*100)+'%');
        if(setters[id])setters[id](value);
        this.renderCanvas();
      };
      trigger.setAttribute('aria-expanded','false');
      trigger.onclick=()=>{
        const opening=pop.parentNode!==document.body||pop.hidden;
        document.querySelectorAll('[data-color-popover]').forEach(other=>{other.hidden=true;other.remove();});
        document.querySelectorAll('[data-color-toggle]').forEach(button=>button.setAttribute('aria-expanded','false'));
        if(!opening)return;
        historyStarted=false;
        document.body.appendChild(pop);
        pop.hidden=false;
        trigger.setAttribute('aria-expanded','true');
        requestAnimationFrame(()=>{place();try{square.focus({preventScroll:true});}catch{}});
      };
      control.querySelectorAll('[data-color-preset]').forEach(button=>button.onclick=()=>{update(button.dataset.colorPreset);this.scheduleSave();});
      hue.oninput=()=>{hsv.h=Number(hue.value);update(hsvToHex(hsv.h,hsv.s,hsv.v));};
      hue.onchange=()=>this.scheduleSave();
      hue.addEventListener('pointerdown',()=>{historyStarted=false;},{passive:true});
      hex.onchange=()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value)){update(hex.value);this.scheduleSave();}else hex.value=current;};
      rgbInputs.forEach(input=>input.onchange=()=>{
        const values=['r','g','b'].map(k=>Number(control.querySelector('[data-color-rgb="'+k+'"]').value));
        update(rgbToHex(...values));this.scheduleSave();
      });
      const setSquare=e=>{
        const rect=square.getBoundingClientRect();
        const x=Math.max(0,Math.min(rect.width,e.clientX-rect.left));
        const y=Math.max(0,Math.min(rect.height,e.clientY-rect.top));
        hsv.s=rect.width?x/rect.width:0;
        hsv.v=rect.height?1-y/rect.height:0;
        update(hsvToHex(hsv.h,hsv.s,hsv.v));
      };
      let activePointer=null;
      const moveSquare=e=>{if(!dragging||e.pointerId!==activePointer)return;setSquare(e);if(e.cancelable)e.preventDefault();};
      const finishSquare=e=>{if(!dragging||(e&&e.pointerId!==activePointer))return;dragging=false;activePointer=null;try{if(square.hasPointerCapture(e.pointerId))square.releasePointerCapture(e.pointerId);}catch{}this.scheduleSave();};
      square.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;dragging=true;activePointer=e.pointerId;try{square.setPointerCapture(e.pointerId);}catch{}setSquare(e);if(e.cancelable)e.preventDefault();});
      square.addEventListener('pointermove',moveSquare,{passive:false});
      square.addEventListener('pointerup',finishSquare);
      square.addEventListener('pointercancel',finishSquare);
      square.addEventListener('lostpointercapture',e=>{if(dragging&&e.pointerId===activePointer){dragging=false;activePointer=null;this.scheduleSave();}});
      pop.addEventListener('keydown',e=>{if(e.key==='Escape'){close();trigger.focus();}});
    });
  }
  enhanceSelects(root){
    // Native select controls are deliberate: browser/Android pickers are reliable,
    // keyboard accessible, and cannot be clipped by transformed scrolling panels.
    root.querySelectorAll('select').forEach(select=>{
      const wrapper=select.closest('.studio-select');
      if(wrapper)wrapper.replaceWith(select);
      select.classList.remove('studio-select-native');
      select.removeAttribute('aria-hidden');
      select.style.removeProperty('position');
      select.style.removeProperty('width');
      select.style.removeProperty('height');
      select.style.removeProperty('opacity');
      select.style.removeProperty('pointer-events');
    });
  }


  async chooseImageAsset(node) { await this.openProjectLibrary(node); }

  renderEventEditor(node,box){
    const host=box.querySelector('#event-editor-content');
    if(!host||!this.project)return;
    if(node.className!=='TextButton'){
      host.innerHTML='<p class="event-editor-note">As interações por toque estão disponíveis nos objetos Botão. Selecione um TextButton para configurar o evento <strong>Ao clicar</strong>.</p>';
      return;
    }
    if(!Array.isArray(this.project.events))this.project.events=[];
    let event=this.project.events.find(item=>item&&item.nodeId===node.id&&(item.event||item.trigger)==='click');
    const all=this.model.getAll();
    const targetOptions='<option value="">Este botão</option>'+all.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+'</option>').join('');
    const actionLabels={setText:'Alterar texto',toggleVisibility:'Mostrar / ocultar',setProperty:'Alterar propriedade',log:'Registrar mensagem'};
    const actionOptions=Object.entries(actionLabels).map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
    const renderAction=(action,index)=>{
      const type=action.type||'setText';
      const target=action.targetId||'';
      let config='';
      if(type==='setText')config='<div class="field"><label>Texto novo</label><textarea data-action-value="'+index+'" rows="2">'+esc(action.value??'Texto atualizado')+'</textarea></div>';
      else if(type==='setProperty'){const property=action.property||'backgroundColor',colorProperty=property==='backgroundColor'||property==='textColor';config='<div class="field"><label>Propriedade</label><select data-action-property="'+index+'"><option value="visible">Visibilidade</option><option value="opacity">Opacidade</option><option value="backgroundColor">Cor de fundo</option><option value="textColor">Cor do texto</option></select></div>'+(colorProperty?'<div class="field"><label>Valor da cor</label>'+this.colorControlMarkup('event-color-'+index,color(action.value,property==='backgroundColor'?'#2563eb':'#ffffff'))+'</div>':'<div class="field"><label>Valor</label><input data-action-value="'+index+'" value="'+esc(action.value??'')+'" placeholder="Ex.: 0.5, true"></div>');}
      else if(type==='log')config='<div class="field"><label>Mensagem</label><input data-action-value="'+index+'" value="'+esc(action.message??'Ação executada')+'"></div>';
      return '<article class="event-action-card"><div class="event-action-heading"><strong>Ação '+(index+1)+'</strong><button type="button" class="event-remove-action" data-remove-action="'+index+'" aria-label="Remover ação">Remover</button></div><div class="field"><label>O que fazer?</label><select data-action-type="'+index+'">'+actionOptions.replace('value="'+type+'"','value="'+type+'" selected')+'</select></div><div class="field"><label>Em qual objeto?</label><select data-action-target="'+index+'">'+targetOptions.replace('value="'+target+'"','value="'+target+'" selected')+'</select></div>'+config+'</article>';
    };
    if(!event){
      host.innerHTML='<p class="event-editor-note">Este botão ainda não tem ações. Adicione uma para definir o que acontece quando alguém tocar nele na prévia.</p><button type="button" class="btn primary event-add-trigger" id="event-create">＋ Criar evento Ao clicar</button>';
      host.querySelector('#event-create').onclick=()=>{
        this.pushHistory();this.project.events.push({id:this.makeId(),nodeId:node.id,event:'click',actions:[]});
        this.renderEventEditor(node,box);this.scheduleSave();
      };
      this.enhanceSelects(host);
      return;
    }
    if(!Array.isArray(event.actions))event.actions=[];
    host.innerHTML='<div class="event-trigger-card"><span class="event-trigger-dot"></span><div><strong>Ao clicar</strong><small>Quando alguém tocar neste botão na prévia</small></div><button type="button" class="event-delete-trigger" id="event-delete">Excluir</button></div>'+
      (event.actions.length?event.actions.map(renderAction).join(''):'<p class="event-editor-note">O evento está criado, mas ainda não faz nada. Adicione sua primeira ação.</p>')+
      '<button type="button" class="btn event-add-action" id="event-add-action">＋ Adicionar ação</button>';
    host.querySelector('#event-delete').onclick=()=>{
      this.pushHistory();this.project.events=this.project.events.filter(item=>item!==event);this.renderEventEditor(node,box);this.scheduleSave();
    };
    host.querySelector('#event-add-action').onclick=()=>{
      this.pushHistory();event.actions.push({type:'setText',targetId:'',value:'Texto atualizado'});this.renderEventEditor(node,box);this.scheduleSave();
    };
    host.querySelectorAll('[data-remove-action]').forEach(button=>button.onclick=()=>{
      this.pushHistory();event.actions.splice(Number(button.dataset.removeAction),1);this.renderEventEditor(node,box);this.scheduleSave();
    });
    host.querySelectorAll('[data-action-type]').forEach(select=>select.onchange=()=>{
      this.pushHistory();const index=Number(select.dataset.actionType),type=select.value;
      event.actions[index]=type==='setText'?{type,targetId:event.actions[index].targetId||'',value:'Texto atualizado'}:type==='toggleVisibility'?{type,targetId:event.actions[index].targetId||''}:type==='setProperty'?{type,targetId:event.actions[index].targetId||'',property:'backgroundColor',value:'#2563eb'}:{type,targetId:event.actions[index].targetId||'',message:'Ação executada'};
      this.renderEventEditor(node,box);this.scheduleSave();
    });
    host.querySelectorAll('[data-action-target]').forEach(select=>select.onchange=()=>{
      this.pushHistory();event.actions[Number(select.dataset.actionTarget)].targetId=select.value;this.scheduleSave();
    });
    host.querySelectorAll('[data-action-value]').forEach(input=>input.onchange=()=>{
      this.pushHistory();const action=event.actions[Number(input.dataset.actionValue)];
      if(action.type==='log')action.message=input.value;
      else if(action.type==='setProperty'){
        const property=host.querySelector('[data-action-property="'+input.dataset.actionValue+'"]')?.value||'backgroundColor';
        action.property=property;
        if(property==='visible')action.value=input.value==='true';
        else if(property==='opacity')action.value=Math.min(1,Math.max(0,Number(input.value)||0));
        else action.value=input.value;
      }else action.value=input.value;
      this.scheduleSave();
    });
    host.querySelectorAll('[data-action-property]').forEach(select=>{
      select.value=event.actions[Number(select.dataset.actionProperty)].property||'backgroundColor';
      select.onchange=()=>{
        this.pushHistory();const action=event.actions[Number(select.dataset.actionProperty)];action.property=select.value;
        action.value=select.value==='visible'?true:select.value==='opacity'?1:select.value==='backgroundColor'?'#2563eb':'#ffffff';
        this.renderEventEditor(node,box);this.scheduleSave();
      };
    });
    const eventColorSetters={};event.actions.forEach((action,index)=>{if(action.type==='setProperty'&&['backgroundColor','textColor'].includes(action.property))eventColorSetters['event-color-'+index]=value=>{action.value=value;this.scheduleSave();};});
    this.bindColorControls(host,eventColorSetters);
    this.enhanceSelects(host);
  }

  deleteSelected() {
    if(!this.selected)return;
    const old=this.selected;
    const parent=old.parent;
    this.pushHistory();
    const removedIds=new Set([old,...old.getAll().slice(1)].map(node=>node.id));
    if(Array.isArray(this.project?.events)){
      this.project.events=this.project.events
        .filter(event=>!removedIds.has(event?.nodeId))
        .map(event=>({...event,actions:(Array.isArray(event.actions)?event.actions:[]).filter(action=>!removedIds.has(action?.targetId))}));
    }
    old.destroy();
    this.selected=parent === this.model.root ? null : parent;
    this.refresh();
    if(this.selected)this.focusNode(this.selected);else this.closePanels();
    this.scheduleSave();
    this.log(old.name+' excluído.');
  }

  async exportFullBackup() {
    const button=$('settings-export-backup'); if(button)button.disabled=true;
    try {
      const result=await createBackupFile(this.vfs);
      const name='Flowiq-Backup-'+new Date().toISOString().slice(0,10)+'.flowiq-backup';
      const file=new File([result.blob],name,{type:result.blob.type});
      let shared=false,downloaded=false;
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        try{
          await navigator.share({files:[file],title:'Backup do Flowiq Studio',text:'Backup dos projetos e da biblioteca.'});
          shared=true;
        }catch(e){
          if(e?.name==='AbortError'){
            this.notify('Compartilhamento cancelado. O backup continua preservado no Studio.');
            return;
          }
          console.warn('Flowiq: compartilhamento indisponível, tentando download.',e);
        }
      }
      if(!shared){
        const url=URL.createObjectURL(result.blob),a=document.createElement('a');
        a.href=url;a.download=name;a.style.display='none';
        document.body.appendChild(a);
        try{a.click();downloaded=true;}
        finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
      }
      this.notify((shared?'Backup enviado para o compartilhamento.':downloaded?'Compartilhamento bloqueado pelo navegador. O download do backup foi solicitado.':'Backup preparado.')+'\n\nProjetos: '+result.projectCount+'\nArquivos da biblioteca: '+result.assetCount+'\nTamanho: '+(result.size/1048576).toFixed(2)+' MB\n\nConfirme se o arquivo foi salvo e guarde uma cópia fora do navegador.');
    }catch(e){
      console.error('Flowiq: falha ao preparar backup.',e);
      this.notify('Não foi possível preparar o backup: '+(e?.message||'erro desconhecido')+'\n\nSeus projetos e arquivos não foram apagados. Tente novamente após fechar outras abas ou liberar espaço no dispositivo.');
    }finally{if(button)button.disabled=false;}
  }
  async importFullBackup(file) {
    if(!file)return;
    try{
      const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      if(raw?.format==='flowiq-studio'||raw?.project||Array.isArray(raw?.data)){
        await this.importProject(file);
        return;
      }
      const data=await inspectBackupFile(file);
      const date=data.createdAt?new Date(data.createdAt).toLocaleString('pt-BR'):'não informada';
      const ok=await this.askConfirm('Backup validado', 'Data: '+date+' · '+data.projectCount+' projetos · '+data.assetCount+' arquivos · '+(data.totalBytes/1048576).toFixed(2)+' MB.\n\nOs dados serão adicionados aos atuais. Nada será sobrescrito e IDs repetidos serão recriados.','Restaurar backup');
      if(!ok)return;
      const result=await restoreBackup(this.vfs,data);
      await this.loadHub();
      this.notify('Restauração concluída!\nProjetos adicionados: '+result.projects+'\nArquivos adicionados: '+result.assets+'\n\nOs dados anteriores foram preservados.');
    }catch(e){this.notify('Backup não restaurado: '+e.message+'\n\nNenhum dado existente foi substituído.');}
    finally{$('backup-file-input').value='';$('file-input').value='';}
  }

  async exportProject() {
    if(!this.project)return;
    try {
      const sourceModel=this.playMode?this.runtime.editorModel:this.model;
      const data=(sourceModel||this.model).toJSON();
      const used=new Set();
      const scan=nodes=>{for(const node of nodes||[]){if(node?.properties?.assetId)used.add(node.properties.assetId);scan(node?.children);}};
      scan(data);
      const stored=await this.vfs.getAssets();
      const assets=[];
      let total=0;
      for(const asset of stored.filter(item=>used.has(item.id))){
        if(!(asset.blob instanceof Blob))throw new Error('Não foi possível ler o asset '+asset.name+'.');
        if(asset.blob.size>12*1024*1024)throw new Error('O asset '+asset.name+' excede o limite de exportação.');
        total+=asset.blob.size;if(total>16*1024*1024)throw new Error('Os assets deste projeto excedem 16 MB.');
        const bytes=new Uint8Array(await asset.blob.arrayBuffer());let binary='';
        for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        assets.push({id:asset.id,name:asset.name,mime:asset.mime,size:asset.blob.size,folder:asset.folder||'',data:btoa(binary)});
      }
      if(assets.length!==used.size)throw new Error('Este projeto referencia um arquivo que não está mais na biblioteca. Repare a imagem antes de exportar.');
      const payload={format:'flowiq-studio',version:3,project:normalizeProject({...this.project,data}),assets};
      const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=(this.project.name.replace(/[^a-z0-9-_]+/gi,'_')||'projeto')+'.flowiq';
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      this.log('Projeto e '+assets.length+' asset(s) exportados.','ok');
    }catch(error){this.notify('Não foi possível exportar o projeto: '+error.message);}
  }

  async importProject(file) {
    if(!file)return;
    try {
      const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      if(raw?.format==='flowiq-studio-backup'){await this.importFullBackup(file);return;}
      const p=raw.project || raw;
      if(!p || !Array.isArray(p.data))throw new Error('Arquivo não contém um projeto Flowiq válido.');
      const existing=Array.isArray(raw.assets)?raw.assets:[];
      if(existing.length>500)throw new Error('O projeto contém assets demais.');
      const ids=new Set(),idMap=new Map(),restoredAssets=[];
      let total=0;
      for(const item of existing){
        if(!item||typeof item.id!=='string'||!item.id||typeof item.data!=='string'||typeof item.name!=='string')throw new Error('Um asset do projeto está inválido.');
        if(ids.has(item.id))throw new Error('O pacote contém IDs de assets duplicados.');
        ids.add(item.id);
        if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data))throw new Error('Conteúdo de asset inválido.');
        const binary=atob(item.data),bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        if(bytes.length!==Number(item.size)||bytes.length>12*1024*1024)throw new Error('Tamanho de asset inconsistente.');
        total+=bytes.length;if(total>16*1024*1024)throw new Error('Os assets excedem o limite de 16 MB.');
        const newId=this.makeId();idMap.set(item.id,newId);
        const mime=String(item.mime||'application/octet-stream').slice(0,120);
        restoredAssets.push({id:newId,name:item.name.slice(0,180),mime,size:bytes.length,folder:String(item.folder||'').slice(0,48),createdAt:new Date().toISOString(),blob:new Blob([bytes],{type:mime})});
      }
      const rewrite=(value,key='')=>{
        if(typeof value==='string')return key==='assetId'?(idMap.get(value)||value):value;
        if(Array.isArray(value))return value.map(item=>rewrite(item,key));
        if(value&&typeof value==='object'){const result={};for(const [k,v] of Object.entries(value))result[k]=rewrite(v,k);return result;}
        return value;
      };
      const imported=createProjectRecord({...p,id:this.makeId(),data:rewrite(p.data),name:String(p.name||file.name.replace(/\.(flowiq|json)$/i,'')).slice(0,64)||'Projeto importado',updatedAt:new Date().toISOString()});
      this.model.loadFromJSON(imported.data);
      imported.data=this.model.toJSON();
      await this.vfs.restoreBackupData([imported],restoredAssets);
      $('file-input').value='';await this.loadHub();await this.openProject(imported.id);
    } catch(e) { this.notify('Falha na importação: '+e.message+'\n\nNenhum dado foi substituído.');$('file-input').value=''; }
  }

  play(force) {
    if(!this.project)return;
    this.playMode=typeof force==='boolean'?force:!this.playMode;
    if(this.playMode){this.project.data=this.model.toJSON();this.runtime.start(this.project);this.model=this.runtime.model;}
    else { this.runtime.stop(); this.model = this.runtime.model; }
    this.closePanels();
    $('workspace').classList.toggle('preview-mode',this.playMode);
    $('preview-window').classList.toggle('open',this.playMode);$('preview-window').setAttribute('aria-hidden',String(!this.playMode));$('preview-window-project').textContent=this.project.name||'Projeto';if(this.playMode)$('preview-canvas').style.zoom=String(this.zoom);
    $('btn-play').innerHTML=this.playMode?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 3 12l6 7M4 12h10a6 6 0 0 1 0 12h-2"/></svg><span>Editor</span>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg><span>Prévia</span>';
    const modeLabel=$('stage-mode-label');
    if(modeLabel)modeLabel.textContent=this.playMode?'PRÉ-VISUALIZAÇÃO':'PALCO 2D';
    this.renderCanvas();

  }

  togglePanel(which) {
    if(!this.isMobile())return;
    const panel=which==='console' ? $('console-panel') : $(which);
    if(!panel)return;
    const isOpen=which==='console' ? panel.classList.contains('expanded') : panel.classList.contains('mobile-open');
    if(isOpen){this.closePanels();return;}
    this.openPanel(which);
  }
  closePanels() {
    $('explorer').classList.remove('mobile-open');$('inspector').classList.remove('mobile-open');
    $('console-panel').classList.remove('expanded');
    $('drawer-backdrop').classList.remove('show');
    document.querySelectorAll('[data-panel]').forEach((tab)=>{tab.classList.remove('active');tab.setAttribute('aria-expanded','false');});
  }
  openPanel(which) {
    if(!this.isMobile())return;
    const panel=which==='console' ? $('console-panel') : $(which);
    if(!panel)return;
    this.closePanels();
    panel.classList.add(which==='console' ? 'expanded' : 'mobile-open');
    $('drawer-backdrop').classList.add('show');
    const tab=document.querySelector('[data-panel="'+which+'"]');
    if(tab){tab.classList.add('active');tab.setAttribute('aria-expanded','true');}
  }

  log(message,type='') {
    const target=$('console-log'); if(!target)return;
    if(type!=='error' && type!=='warn')return;
    const line=document.createElement('div');line.className=type==='error'?'log-error':'log-warn';
    line.textContent=message;
    target.append(line);target.scrollTop=target.scrollHeight;
  }
}

window.addEventListener('DOMContentLoaded',()=>{new StudioApp();const intro=$('studio-intro');if(intro)setTimeout(()=>intro.classList.add('is-hidden'),1450);});
