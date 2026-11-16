import { DataModel, Instance } from './datamodel.js?v=2026.11.16.5';
import { VirtualFS } from './vfs.js?v=2026.11.16.5';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;

class StudioApp {
  constructor() {
    this.vfs = new VirtualFS();
    this.model = new DataModel();
    this.projects = [];
    this.project = null;
    this.selected = null;
    this.drag = null;
    this.saveTimer = null;
    this.saving = false;
    this.playMode = false;
    this.zoom = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.bind();
    this.loadHub();
  }

  bind() {
    $('btn-new').onclick = () => this.createProject();
    $('btn-hub').onclick = async () => { await this.save(); this.toHub(); };
    $('btn-save').onclick = () => this.save();
    $('btn-export').onclick = () => this.exportProject();
    $('btn-import').onclick = () => $('file-input').click();
    $('file-input').onchange = (e) => this.importProject(e.target.files?.[0]);
    $('add-frame').onclick = () => this.add('Frame');
    $('add-button').onclick = () => this.add('TextButton');
    $('add-label').onclick = () => this.add('TextLabel');
    $('add-image').onclick = () => this.add('ImageLabel');
    $('btn-play').onclick = () => this.play();
    $('mobile-play').onclick = () => this.play();
    $('mobile-add').onclick = () => { this.closePanels(); this.togglePanel('explorer'); };
    $('zoom-in').onclick = () => this.setZoom(this.zoom + 0.1);
    $('zoom-out').onclick = () => this.setZoom(this.zoom - 0.1);
    $('zoom-fit').onclick = () => this.fitCanvas();
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
    document.addEventListener('pointermove', (e) => this.moveDrag(e));
    document.addEventListener('pointerup', () => this.endDrag());
    document.addEventListener('pointercancel', () => this.endDrag());
    window.addEventListener('resize', () => { this.closePanels(); this.renderSelectionHandles(); });
    document.addEventListener('keydown', (e) => {
      const editingText = ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !editingText) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !editingText) { e.preventDefault(); this.redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === '0') { e.preventDefault(); this.fitCanvas(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && this.selected) { e.preventDefault(); this.duplicateSelected(); }
      if (e.key === 'Escape') { this.closePanels(); this.hideModal(); if (this.playMode) this.play(false); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) this.deleteSelected();
    });
    $('modal').onclick = (e) => { if (e.target === $('modal')) this.hideModal(); };
  }

  async loadHub() {
    try { this.projects = await this.vfs.getProjects(); this.renderHub(); }
    catch (e) { this.log('Falha ao abrir armazenamento: ' + e.message, 'error'); $('project-list').innerHTML = '<div class="empty">Não foi possível acessar os projetos. Verifique se o navegador permite armazenamento local.</div>'; }
  }

  renderHub() {
    $('project-count').textContent = this.projects.length + (this.projects.length === 1 ? ' projeto' : ' projetos');
    const list = $('project-list');
    if (!this.projects.length) { list.innerHTML = '<div class="empty">Nenhum projeto por aqui ainda.<br>Crie um projeto para começar.</div>'; return; }
    list.innerHTML = [...this.projects].sort((a,b) => new Date(b.updatedAt || 0)-new Date(a.updatedAt || 0)).map(p => `
      <article class="project-card"><h3>▣ ${esc(p.name)}</h3><p>Atualizado em ${new Date(p.updatedAt || Date.now()).toLocaleString('pt-BR')}</p><div class="project-actions"><button class="btn primary" data-open="${esc(p.id)}">Abrir Studio →</button><button class="btn danger" data-delete="${esc(p.id)}" title="Excluir">⌫</button></div></article>`).join('');
    list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => this.openProject(b.dataset.open));
    list.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => this.deleteProject(b.dataset.delete));
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
      const p = {id:this.makeId(),name,updatedAt:new Date().toISOString(),data:[frame.toJSON()]};
      try { await this.vfs.saveProject(p); this.hideModal(); await this.openProject(p.id); }
      catch (e) { this.log('Erro ao criar projeto: '+e.message,'error'); }
    };
    $('new-name').focus();
  }

  makeId() { return globalThis.crypto?.randomUUID?.() || 'proj_'+Date.now()+'_'+Math.random().toString(36).slice(2); }
  hideModal() { $('modal').classList.remove('open'); }

  async deleteProject(id) {
    const p = this.projects.find(x => x.id === id);
    if (!p || !confirm('Excluir permanentemente "'+p.name+'"?')) return;
    try { await this.vfs.deleteProject(id); await this.loadHub(); }
    catch (e) { this.log('Erro ao excluir: '+e.message,'error'); }
  }

  async openProject(id) {
    try {
      const p = await this.vfs.getProject(id);
      if (!p) throw new Error('Projeto não encontrado.');
      this.project = p;
      this.model.loadFromJSON(p.data || []);
      this.selected = null;
      this.undoStack = []; this.redoStack = [];
      this.playMode = false;
      $('hub').classList.remove('active'); $('workspace').classList.add('active');
      $('btn-save').disabled = false; $('btn-export').disabled = false;
      $('project-title').textContent = p.name;
      this.closePanels(); this.refresh();
      this.log('Projeto "'+p.name+'" aberto.','ok');
    } catch (e) { this.log('Não foi possível abrir o projeto: '+e.message,'error'); }
  }

  async toHub() {
    this.project = null; this.selected = null; this.playMode = false;
    $('workspace').classList.remove('active'); $('hub').classList.add('active');
    $('btn-save').disabled = true; $('btn-export').disabled = true;
    this.closePanels(); await this.loadHub();
  }

  async save() {
    if (!this.project || this.saving) return;
    clearTimeout(this.saveTimer);
    this.saving = true;
    try {
      this.project.data = this.model.toJSON();
      this.project.updatedAt = new Date().toISOString();
      await this.vfs.saveProject(this.project);
      $('btn-save').textContent = 'Salvo ✓';
      this.log('Projeto salvo.','ok');
      setTimeout(() => { if ($('btn-save')) $('btn-save').textContent = 'Salvar'; }, 1200);
    } catch (e) { this.log('Erro ao salvar: '+e.message,'error'); }
    finally { this.saving = false; }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 650);
  }

  add(type) {
    if (!this.project || this.playMode) return;
    this.pushHistory();
    let parent = this.selected?.className === 'Frame' ? this.selected : this.model.root.children[0];
    if (type === 'Frame' || !parent) parent = this.model.root;
    const count = this.model.getAll().filter(n => n.className === type).length;
    const node = new Instance(type, type + '_' + (count+1));
    node.properties.positionX = 18 + (count%5)*12;
    node.properties.positionY = 18 + (count%5)*12;
    node.setParent(parent);
    this.select(node);
    this.log(type+' adicionado.','ok'); this.scheduleSave();
  }

  select(node) { this.selected = node; this.refresh(); }

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
    const cloneTree = (original, parent, isRoot = false) => {
      const copy = new Instance(original.className, original.name + '_copia');
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
    this.select(copy);
    this.scheduleSave();
    this.log(source.name + ' duplicado.', 'ok');
  }
  refresh() { this.renderTree(); this.renderCanvas(); this.renderInspector(); this.updateHistoryButtons(); }

  renderTree() {
    const root = $('tree'); root.replaceChildren();
    const walk = (parent, depth) => parent.children.forEach(node => {
      const row = document.createElement('div');
      row.className = 'tree-row'+(this.selected === node ? ' selected' : '');
      row.style.paddingLeft = (7 + depth*14)+'px';
      const glyph = node.className === 'Frame' ? '▧' : node.className === 'TextButton' ? '▣' : node.className === 'ImageLabel' ? '▨' : 'T';
      row.innerHTML = '<span>'+glyph+'</span><span class="node-name">'+esc(node.name)+'</span><span class="muted">'+(node.children.length?'⌄':'')+'</span>';
      row.onclick = () => this.select(node); root.append(row); walk(node,depth+1);
    });
    walk(this.model.root,0);
    if (!root.children.length) root.innerHTML = '<p class="muted" style="font-size:11px;padding:10px">Adicione um Frame para começar.</p>';
  }

  renderCanvas() {
    const canvas = $('canvas'); canvas.replaceChildren();
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
      el.style.border = node.className === 'TextButton' ? '1px solid #ffffff30' : 'none';
      el.style.position = 'absolute';
      if (node.className === 'Frame') { el.style.display='block'; el.style.overflow='hidden'; el.style.outlineOffset='2px'; }
      el.textContent = p.text || (node.className === 'Frame' ? '' : node.name);
      if (node.className === 'TextButton' && this.playMode) {
        el.type = 'button'; el.onclick = () => this.log('Ação executada: '+node.name,'ok');
      } else if (!this.playMode) {
        el.onclick = (e) => { e.stopPropagation(); this.select(node); };
      }
      parentEl.append(el);
      if (node.className === 'Frame') node.children.forEach(child => renderNode(child,el));
    };
    this.model.root.children.forEach(node => renderNode(node,canvas));
    if (!canvas.children.length) canvas.innerHTML = '<div class="empty-canvas">Seu palco está vazio.<br>Adicione um Frame para começar.</div>';
    this.renderSelectionHandles();
  }

  startDrag(event) {
    if (!this.project || this.playMode || event.button !== 0) return;
    if (window.matchMedia('(max-width: 760px)').matches) return;
    const handle=event.target.closest('[data-resize]');
    const el=handle?[...$('canvas').querySelectorAll('[data-node-id]')].find(item=>item.dataset.nodeId===handle.dataset.nodeId):event.target.closest('[data-node-id]');
    if(!el)return;
    const node=this.model.find(el.dataset.nodeId);if(!node)return;
    this.selected=node;
    const parent=el.parentElement,parentRect=parent.getBoundingClientRect();
    this.drag={node,el,mode:handle?'resize':'move',direction:handle?.dataset.resize||'',startX:event.clientX,startY:event.clientY,
      baseX:Number(node.properties.positionX)||0,baseY:Number(node.properties.positionY)||0,
      baseW:Math.max(1,Number(node.properties.width)||1),baseH:Math.max(1,Number(node.properties.height)||1),
      moved:false,historyRecorded:false,scaleX:parentRect.width/(parent.clientWidth||parentRect.width),scaleY:parentRect.height/(parent.clientHeight||parentRect.height)};
    this.renderTree();this.renderInspector();this.renderSelectionHandles();event.preventDefault();
  }

  moveDrag(event) {
    if(!this.drag)return;
    const d=this.drag,dx=(event.clientX-d.startX)/(d.scaleX||1),dy=(event.clientY-d.startY)/(d.scaleY||1);
    if(Math.abs(dx)+Math.abs(dy)>3)d.moved=true;if(!d.moved)return;
    if(!d.historyRecorded){this.pushHistory();d.historyRecorded=true;}
    const p=d.node.properties;
    if(d.mode==='resize'){
      const dir=d.direction;let x=d.baseX,y=d.baseY,w=d.baseW,h=d.baseH;
      if(dir.includes('e'))w=Math.max(24,d.baseW+dx);
      if(dir.includes('s'))h=Math.max(24,d.baseH+dy);
      if(dir.includes('w')){w=Math.max(24,d.baseW-dx);x=d.baseX+d.baseW-w;}
      if(dir.includes('n')){h=Math.max(24,d.baseH-dy);y=d.baseY+d.baseH-h;}
      p.positionX=Math.round(x);p.positionY=Math.round(y);p.width=Math.round(w);p.height=Math.round(h);
      d.el.style.left=p.positionX+'px';d.el.style.top=p.positionY+'px';d.el.style.width=p.width+'px';d.el.style.height=p.height+'px';
      const width=$('p-w'),height=$('p-h'),px=$('p-x'),py=$('p-y');
      if(width)width.value=p.width;if(height)height.value=p.height;if(px)px.value=p.positionX;if(py)py.value=p.positionY;
    }else{
      p.positionX=Math.round(d.baseX+dx);p.positionY=Math.round(d.baseY+dy);
      d.el.style.left=p.positionX+'px';d.el.style.top=p.positionY+'px';
      const x=$('p-x'),y=$('p-y');if(x)x.value=p.positionX;if(y)y.value=p.positionY;
    }
    this.updateSelectionHandles();
  }

  endDrag(){if(!this.drag)return;const moved=this.drag.moved;this.drag=null;if(moved){this.updateSelectionHandles();this.scheduleSave();}}

  renderSelectionHandles(){
    const canvas=$('canvas');canvas.querySelector('.selection-box')?.remove();
    if (window.matchMedia('(max-width: 760px)').matches) return;
    if(!this.selected||this.playMode)return;
    const el=[...canvas.querySelectorAll('[data-node-id]')].find(item=>item.dataset.nodeId===this.selected.id);if(!el)return;
    const overlay=document.createElement('div'),cr=canvas.getBoundingClientRect(),r=el.getBoundingClientRect();
    overlay.className='selection-box';overlay.style.left=((r.left-cr.left)/this.zoom)+'px';overlay.style.top=((r.top-cr.top)/this.zoom)+'px';
    overlay.style.width=(r.width/this.zoom)+'px';overlay.style.height=(r.height/this.zoom)+'px';
    ['nw','n','ne','e','se','s','sw','w'].forEach(dir=>{const h=document.createElement('button');h.type='button';h.className='resize-handle';h.dataset.resize=dir;h.dataset.nodeId=this.selected.id;h.setAttribute('aria-label','Redimensionar '+dir);overlay.append(h);});
    canvas.append(overlay);
  }

  updateSelectionHandles(){
    const overlay=$('canvas').querySelector('.selection-box');if(!overlay||!this.drag)return;
    const r=this.drag.el.getBoundingClientRect(),cr=$('canvas').getBoundingClientRect();
    overlay.style.left=((r.left-cr.left)/this.zoom)+'px';overlay.style.top=((r.top-cr.top)/this.zoom)+'px';
    overlay.style.width=(r.width/this.zoom)+'px';overlay.style.height=(r.height/this.zoom)+'px';
  }

  pushHistory(){
    if(!this.project)return;
    this.undoStack.push({data:JSON.parse(JSON.stringify(this.model.toJSON())),selectedId:this.selected?.id||null});
    if(this.undoStack.length>80)this.undoStack.shift();this.redoStack.length=0;this.updateHistoryButtons();
  }
  restoreHistory(snapshot){this.model.loadFromJSON(snapshot.data);this.selected=snapshot.selectedId?this.model.find(snapshot.selectedId):null;this.refresh();this.scheduleSave();}
  undo(){if(!this.undoStack.length)return;this.redoStack.push({data:JSON.parse(JSON.stringify(this.model.toJSON())),selectedId:this.selected?.id||null});this.restoreHistory(this.undoStack.pop());this.log('Ação desfeita.','ok');}
  redo(){if(!this.redoStack.length)return;this.undoStack.push({data:JSON.parse(JSON.stringify(this.model.toJSON())),selectedId:this.selected?.id||null});this.restoreHistory(this.redoStack.pop());this.log('Ação refeita.','ok');}
  updateHistoryButtons(){const u=$('undo-action'),r=$('redo-action');if(u)u.disabled=!this.undoStack.length;if(r)r.disabled=!this.redoStack.length;}

  renderInspector() {
    const box=$('inspector-content'), node=this.selected;
    if(!node){box.innerHTML='<p class="muted">Selecione um objeto no Explorer ou no palco para editar suas propriedades.</p>';return;}
    const p=node.properties;
    box.innerHTML = `
      <div class="field"><label>Nome</label><input id="p-name" maxlength="64" value="${esc(node.name)}"></div>
      <div class="field"><label>Classe</label><input disabled value="${esc(node.className)}"></div><hr class="divider">
      <details class="property-group" open><summary>Layout e tamanho</summary>
        <div class="field-grid"><div class="field"><label>Posição X</label><input type="number" id="p-x" value="${p.positionX??0}"></div><div class="field"><label>Posição Y</label><input type="number" id="p-y" value="${p.positionY??0}"></div><div class="field"><label>Largura</label><input type="number" min="1" id="p-w" value="${p.width??100}"></div><div class="field"><label>Altura</label><input type="number" min="1" id="p-h" value="${p.height??40}"></div></div>
      </details>
      <details class="property-group" open><summary>Aparência</summary>
        <div class="field"><label>Texto / Conteúdo</label><textarea id="p-text" rows="2">${esc(p.text||'')}</textarea></div>
        <div class="field-grid"><div class="field"><label>Fundo</label><input type="color" id="p-bg" value="${color(p.backgroundColor,'#182235')}"></div><div class="field"><label>Texto</label><input type="color" id="p-fg" value="${color(p.textColor,'#ffffff')}"></div></div>
        <div class="field-grid"><div class="field"><label>Raio da borda</label><input type="number" min="0" max="100" id="p-radius" value="${p.borderRadius??8}"></div><div class="field"><label>Tamanho da fonte</label><input type="number" min="8" max="72" id="p-font" value="${p.fontSize??14}"></div></div>
      </details>
      <label class="visibility-control"><input type="checkbox" id="p-visible" ${p.visible!==false?'checked':''}> Visível</label>
      <div class="inspector-actions"><button class="btn" id="duplicate-node">⧉ Duplicar</button><button class="btn danger" id="delete-node">⌫ Excluir</button></div>`;
    const fields={
      'p-name':v=>{node.name=v;this.renderTree();},
      'p-x':v=>p.positionX=Number(v)||0,'p-y':v=>p.positionY=Number(v)||0,
      'p-w':v=>p.width=Math.max(1,Number(v)||1),'p-h':v=>p.height=Math.max(1,Number(v)||1),
      'p-text':v=>p.text=v,'p-bg':v=>p.backgroundColor=v,'p-fg':v=>p.textColor=v,
      'p-radius':v=>p.borderRadius=Math.max(0,Number(v)||0),'p-font':v=>p.fontSize=Math.max(8,Number(v)||8)
    };
    Object.entries(fields).forEach(([id,set])=>{const field=$(id);field.onfocus=()=>this.pushHistory();field.oninput=e=>{set(e.target.value);this.renderCanvas();this.scheduleSave();};});
    $('p-visible').onfocus=()=>this.pushHistory();
    $('p-visible').onchange=e=>{p.visible=e.target.checked;this.renderCanvas();this.scheduleSave();};
    $('delete-node').onclick=()=>this.deleteSelected();
    $('duplicate-node').onclick=()=>this.duplicateSelected();
  }

  deleteSelected() {
    if(!this.selected)return;
    const old=this.selected; const parent=old.parent; this.pushHistory(); old.destroy(); this.selected=parent === this.model.root ? null : parent;
    this.refresh(); this.scheduleSave(); this.log(old.name+' excluído.');
  }

  exportProject() {
    if(!this.project)return;
    const payload={format:'flowiq-studio',version:1,project:{...this.project,data:this.model.toJSON()}};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url;a.download=(this.project.name.replace(/[^a-z0-9-_]+/gi,'_')||'projeto')+'.flowiq';a.click();URL.revokeObjectURL(url);
    this.log('Projeto exportado.','ok');
  }

  async importProject(file) {
    if(!file)return;
    try {
      const raw=JSON.parse(await file.text());
      const p=raw.project || raw;
      if(!p || !Array.isArray(p.data))throw new Error('Arquivo não contém um projeto Flowiq válido.');
      const imported={id:this.makeId(),name:String(p.name||file.name.replace(/\.(flowiq|json)$/i,'')).slice(0,64)||'Projeto importado',updatedAt:new Date().toISOString(),data:p.data};
      this.model.loadFromJSON(imported.data);
      imported.data=this.model.toJSON();
      await this.vfs.saveProject(imported);
      $('file-input').value='';await this.loadHub();await this.openProject(imported.id);
      this.log('Projeto importado com sucesso.','ok');
    } catch(e) { this.log('Falha na importação: '+e.message,'error'); }
  }

  play(force) {
    if(!this.project)return;
    this.playMode=typeof force==='boolean'?force:!this.playMode;
    $('btn-play').textContent=this.playMode?'■ Editar':'▶ Prévia';
    this.renderCanvas();
    this.log(this.playMode?'Prévia iniciada.':'Modo de edição.','ok');
  }

  togglePanel(which) {
    const panel=$(which); if(!panel)return;
    if (window.matchMedia('(max-width: 760px)').matches) { const nav=document.querySelector('[data-panel="'+which+'"]'); if(panel.classList.contains('mobile-open')) { this.closePanels(); return; } }
    const opening=!panel.classList.contains('mobile-open');
    this.closePanels();
    if(opening){
      panel.classList.add('mobile-open');
      $('drawer-backdrop').classList.add('show');
      const tab=document.querySelector('[data-panel="'+which+'"]');
      if(tab){tab.classList.add('active');tab.setAttribute('aria-expanded','true');}
    }
  }
  closePanels() {
    $('explorer').classList.remove('mobile-open');$('inspector').classList.remove('mobile-open');
    $('drawer-backdrop').classList.remove('show');
    document.querySelectorAll('[data-panel]').forEach((tab)=>{tab.classList.remove('active');tab.setAttribute('aria-expanded','false');});
  }

  log(message,type='') {
    const target=$('console-log'); if(!target)return;
    const line=document.createElement('div');line.className=type==='error'?'log-error':type==='ok'?'log-ok':'';
    line.textContent='['+new Date().toLocaleTimeString('pt-BR')+'] '+message;
    target.append(line);target.scrollTop=target.scrollHeight;
  }
}

window.addEventListener('DOMContentLoaded',()=>new StudioApp());
