
import { DataModel, Instance } from './datamodel.js';
import { VirtualFS } from './vfs.js';

const $ = (id) => document.getElementById(id);

const escapeHTML = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

class StudioApp {
  constructor() {
    this.vfs = new VirtualFS();
    this.model = new DataModel();
    this.projects = [];
    this.project = null;
    this.selected = null;
    this.drag = null;
    this.saveTimer = null;

    this.bind();
    this.loadHub();
  }

  bind() {
    $('btn-new').onclick = () => this.createProject();
    $('btn-save').onclick = () => this.save();
    $('btn-import').onclick = () => $('file-input').click();
    $('file-input').onchange = (event) => this.importFile(event);
    $('btn-export').onclick = () => this.exportProject();
    $('btn-hub').onclick = () => this.toHub();

    $('add-frame').onclick = () => this.add('Frame');
    $('add-button').onclick = () => this.add('TextButton');

    $('btn-play').onclick = () => this.play();
    $('mobile-play').onclick = () => this.play();
    $('mobile-add').onclick = () => this.add('TextButton');

    $('clear-console').onclick = () => {
      $('console-log').replaceChildren();
    };

    $('drawer-backdrop').onclick = () => this.closePanels();

    document.querySelectorAll('[data-panel]').forEach((button) => {
      button.onclick = () => this.togglePanel(button.dataset.panel);
    });

    document.querySelectorAll('[data-close-panel]').forEach((button) => {
      button.onclick = () => this.closePanels();
    });

    $('canvas').onclick = (event) => {
      if (event.target === $('canvas')) {
        this.select(null);
      }
    };

    $('canvas').addEventListener('pointerdown', (event) => {
      this.startDrag(event);
    });

    document.addEventListener('pointermove', (event) => {
      this.moveDrag(event);
    });

    document.addEventListener('pointerup', () => {
      this.endDrag();
    });

    document.addEventListener('pointercancel', () => {
      this.endDrag();
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.save();
      }

      if (event.key === 'Escape') {
        this.closePanels();
        this.hideModal();
      }

      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        this.selected &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      ) {
        this.deleteSelected();
      }
    });

    $('modal').addEventListener('click', (event) => {
      if (event.target === $('modal')) {
        this.hideModal();
      }
    });
  }

  async loadHub() {
    try {
      this.projects = await this.vfs.getProjects();
      this.renderHub();
    } catch (error) {
      this.log('Erro ao carregar projetos: ' + error.message, 'error');
    }
  }

  renderHub() {
    const list = $('project-list');

    $('project-count').textContent =
      `${this.projects.length} ${
        this.projects.length === 1 ? 'projeto' : 'projetos'
      }`;

    if (!this.projects.length) {
      list.innerHTML = `
        <div class="empty">
          Nenhum projeto por aqui ainda.<br>
          Crie um projeto para começar a construir.
        </div>
      `;
      return;
    }

    const sorted = [...this.projects].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );

    list.innerHTML = sorted.map((project) => `
      <article class="project-card">
        <h3>▣ ${escapeHTML(project.name)}</h3>

        <p>
          Atualizado em
          ${new Date(project.updatedAt || Date.now()).toLocaleString('pt-BR')}
        </p>

        <div class="project-actions">
          <button class="btn primary"
            data-open="${escapeHTML(project.id)}">
            Abrir Studio →
          </button>

          <button class="btn danger"
            data-delete="${escapeHTML(project.id)}"
            title="Excluir projeto">
            ⌫
          </button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-open]').forEach((button) => {
      button.onclick = () => this.openProject(button.dataset.open);
    });

    list.querySelectorAll('[data-delete]').forEach((button) => {
      button.onclick = () => this.deleteProject(button.dataset.delete);
    });
  }

  createProject() {
    this.showModal(`
      <h2>Novo projeto</h2>

      <div class="field">
        <label>Nome do sistema</label>
        <input
          id="new-name"
          maxlength="48"
          value="Meu Sistema OS"
          placeholder="Ex.: NeoOS"
        >
      </div>

      <div class="modal-actions">
        <button class="btn" id="cancel-modal">Cancelar</button>
        <button class="btn primary" id="confirm-create">
          Criar projeto
        </button>
      </div>
    `);

    $('cancel-modal').onclick = () => this.hideModal();

    $('confirm-create').onclick = async () => {
      const name = $('new-name').value.trim();

      if (!name) {
        $('new-name').focus();
        return;
      }

      const frame = new Instance('Frame', 'JanelaPrincipal');

      Object.assign(frame.properties, {
        width: 300,
        height: 210,
        positionX: 24,
        positionY: 30
      });

      const label = new Instance('TextLabel', 'Titulo');

      Object.assign(label.properties, {
        text: 'Bem-vindo ao ' + name,
        positionX: 15,
        positionY: 12,
        width: 270,
        height: 34
      });

      label.setParent(frame);

      const button = new Instance('TextButton', 'BotaoAcao');

      Object.assign(button.properties, {
        positionX: 75,
        positionY: 100,
        text: 'Começar'
      });

      button.setParent(frame);

      const project = {
        id: this.makeId(),
        name,
        updatedAt: new Date().toISOString(),
        data: [frame.toJSON()]
      };

      try {
        await this.vfs.saveProject(project);
        this.hideModal();
        await this.openProject(project.id);
      } catch (error) {
        alert('Erro ao criar projeto: ' + error.message);
      }
    };

    $('new-name').focus();
  }

  makeId() {
    return globalThis.crypto?.randomUUID?.() ||
      'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }

  async deleteProject(id) {
    const project = this.projects.find((item) => item.id === id);

    if (!project) return;

    if (!confirm(`Excluir permanentemente o projeto "${project.name}"?`)) {
      return;
    }

    try {
      await this.vfs.deleteProject(id);
      await this.loadHub();
      this.log(`Projeto ${project.name} excluído.`);
    } catch (error) {
      this.log('Erro ao excluir projeto: ' + error.message, 'error');
    }
  }

  async openProject(id) {
    try {
      this.projects = await this.vfs.getProjects();

      this.project = this.projects.find((item) => item.id === id);

      if (!this.project) {
        throw new Error('Projeto não encontrado.');
      }

      this.model.loadFromJSON(this.project.data || []);
      this.selected = this.model.getAll()[0] || null;

      $('hub').classList.remove('active');
      $('workspace').classList.add('active');

      $('btn-save').disabled = false;
      $('btn-export').disabled = false;

      $('project-title').textContent = this.project.name;
      $('breadcrumb').textContent = '/ ' + this.project.name;

      this.closePanels();
      this.refresh();

      this.log(`Projeto "${this.project.name}" aberto.`, 'ok');
    } catch (error) {
      this.log('Não foi possível abrir o projeto: ' + error.message, 'error');
      alert(error.message);
    }
  }

  toHub() {
    this.project = null;
    this.selected = null;

    $('workspace').classList.remove('active');
    $('hub').classList.add('active');

    $('btn-save').disabled = true;
    $('btn-export').disabled = true;

    $('breadcrumb').textContent = '/ Projetos';

    this.closePanels();
    this.loadHub();
  }

  async save() {
    if (!this.project) return;

    try {
      this.project.data = this.model.root.children.map(
        (node) => node.toJSON()
      );

      this.project.updatedAt = new Date().toISOString();

      await this.vfs.saveProject(this.project);

      this.log('Projeto salvo com sucesso.', 'ok');

      const button = $('btn-save');
      const previousText = button.textContent;

      button.textContent = 'Salvo ✓';

      setTimeout(() => {
        button.textContent = previousText;
      }, 1300);
    } catch (error) {
      this.log('Erro ao salvar: ' + error.message, 'error');
      alert('Não foi possível salvar o projeto.');
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);

    this.saveTimer = setTimeout(() => {
      this.save();
    }, 1200);
  }

  add(type) {
    if (!this.project) return;

    const parent =
      this.selected?.className === 'Frame'
        ? this.selected
        : this.model.root.children[0] || this.model.root;

    const count = this.model.getAll().filter(
      (node) => node.className === type
    ).length;

    const node = new Instance(type, `${type}_${count + 1}`);

    node.properties.positionX = 20 + count * 12;
    node.properties.positionY = 20 + count * 12;

    node.setParent(parent);

    this.select(node);
    this.closePanels();

    this.log(`${type} adicionado em ${parent.name}.`);

    this.scheduleSave();
  }

  select(node) {
    this.selected = node;
    this.refresh();
  }

  refresh() {
    this.renderTree();
    this.renderCanvas();
    this.renderInspector();
  }

  renderTree() {
    const root = $('tree');

    root.replaceChildren();

    const walk = (node, depth) => {
      node.children.forEach((child) => {
        const row = document.createElement('div');

        row.className =
          'tree-row' +
          (this.selected === child ? ' selected' : '');

        row.style.paddingLeft = `${8 + depth * 15}px`;

        const icon =
          child.className === 'Frame' ? '▧' :
          child.className === 'TextButton' ? '▣' : 'T';

        row.innerHTML = `
          <span>${icon}</span>
          <span class="node-name">${escapeHTML(child.name)}</span>
          <span class="muted">
            ${child.children.length ? '⌄' : ''}
          </span>
        `;

        row.onclick = () => this.select(child);

        root.append(row);

        walk(child, depth + 1);
      });
    };

    walk(this.model.root, 0);

    if (!root.children.length) {
      root.innerHTML = `
        <p class="muted" style="padding:10px;font-size:11px">
          Nenhuma instância. Adicione um Frame.
        </p>
      `;
    }
  }

  renderCanvas(target = $('canvas'), playMode = false) {
    target.replaceChildren();

    const renderNode = (node, container) => {
      if (node.properties.visible === false) return;

      const properties = node.properties;

      const element = document.createElement(
        node.className === 'TextButton' && !playMode
          ? 'button'
          : 'div'
      );

      element.className =
        'node' +
        (this.selected === node && !playMode ? ' selected' : '') +
        (node.className === 'TextButton' ? ' button-node' : '');

      element.style.position = 'absolute';
      element.style.left = `${Number(properties.positionX) || 0}px`;
      element.style.top = `${Number(properties.positionY) || 0}px`;

      element.style.width =
        `${Math.max(1, Number(properties.width) || 1)}px`;

      element.style.height =
        `${Math.max(1, Number(properties.height) || 1)}px`;

      element.style.background =
        properties.backgroundColor || 'transparent';

      element.style.color =
        properties.textColor || '#ffffff';

      element.style.borderRadius =
        `${Math.max(0, Number(properties.borderRadius) || 0)}px`;

      element.style.fontSize =
        `${Math.max(8, Number(properties.fontSize) || 13)}px`;

      element.style.border =
        node.className === 'TextButton'
          ? '1px solid #ffffff30'
          : 'none';

      element.style.boxSizing = 'border-box';
      element.style.overflow = 'hidden';
      element.style.display = 'grid';
      element.style.placeItems = 'center';
      element.style.padding = '4px';
      element.style.textAlign = 'center';

      element.textContent = properties.text || node.name;

      if (node.className === 'TextButton' && !playMode) {
        element.type = 'button';
      }

      if (!playMode) {
        element.dataset.nodeId = node.id;

        element.onclick = (event) => {
          event.stopPropagation();
          this.select(node);
        };
      } else if (node.className === 'TextButton') {
        element.onclick = () => {
          this.log(`Ação executada: ${node.name}`, 'ok');
        };
      }

      container.append(element);

      node.children.forEach((child) => {
        renderNode(child, container);
      });
    };

    this.model.root.children.forEach((node) => {
      renderNode(node, target);
    });

    if (!target.children.length) {
      target.innerHTML = `
        <div class="empty-canvas">
          Seu palco está vazio.<br>
          Adicione um Frame ou Botão pelo Explorer.
        </div>
      `;
    }
  }

  startDrag(event) {
    if (!this.project || event.button !== 0) return;

    const element = event.target.closest('[data-node-id]');

    if (!element) return;

    const node = this.model.find(element.dataset.nodeId);

    if (!node) return;

    this.selected = node;

    this.drag = {
      node,
      startX: event.clientX,
      startY: event.clientY,
      originalX: Number(node.properties.positionX) || 0,
      originalY: Number(node.properties.positionY) || 0,
      moved: false
    };

    this.renderTree();
    this.renderInspector();

    event.preventDefault();
  }

  moveDrag(event) {
    if (!this.drag) return;

    const canvas = $('canvas');
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.offsetWidth
      ? rect.width / canvas.offsetWidth
      : 1;

    const scaleY = canvas.offsetHeight
      ? rect.height / canvas.offsetHeight
      : 1;

    const deltaX = (event.clientX - this.drag.startX) / (scaleX || 1);
    const deltaY = (event.clientY - this.drag.startY) / (scaleY || 1);

    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) {
      this.drag.moved = true;
    }

    if (!this.drag.moved) return;

    this.drag.node.properties.positionX =
      Math.round(this.drag.originalX + deltaX);

    this.drag.node.properties.positionY =
      Math.round(this.drag.originalY + deltaY);

    const element = canvas.querySelector(
      `[data-node-id="${this.drag.node.id}"]`
    );

    if (element) {
      element.style.left =
        `${this.drag.node.properties.positionX}px`;

      element.style.top =
        `${this.drag.node.properties.positionY}px`;
    }

    this.updatePositionFields();
  }

  endDrag() {
    if (!this.drag) return;

    const moved = this.drag.moved;

    this.drag = null;

    if (moved) {
      this.renderTree();
      this.renderInspector();
      this.scheduleSave();
    }
  }

  updatePositionFields() {
    if (!this.selected) return;

    const x = $('p-x');
    const y = $('p-y');

    if (x) x.value = this.selected.properties.positionX;
    if (y) y.value = this.selected.properties.positionY;
  }

  renderInspector() {
    const container = $('inspector-content');
    const node = this.selected;

    if (!node) {
      container.innerHTML = `
        <p class="muted">
          Selecione um objeto no Explorer ou no palco
          para editar suas propriedades.
        </p>
      `;
      return;
    }

    const properties = node.properties;

    container.innerHTML = `
      <div class="field">
        <label>Nome</label>
        <input
          id="p-name"
          maxlength="64"
          value="${escapeHTML(node.name)}"
        >
      </div>

      <div class="field">
        <label>Classe</label>
        <input disabled value="${escapeHTML(node.className)}">
      </div>

      <hr class="divider">

      <div class="field-grid">
        <div class="field">
          <label>Posição X</label>
          <input type="number" id="p-x"
            value="${properties.positionX}">
        </div>

        <div class="field">
          <label>Posição Y</label>
          <input type="number" id="p-y"
            value="${properties.positionY}">
        </div>

        <div class="field">
          <label>Largura</label>
          <input type="number" min="1" id="p-w"
            value="${properties.width}">
        </div>

        <div class="field">
          <label>Altura</label>
          <input type="number" min="1" id="p-h"
            value="${properties.height}">
        </div>
      </div>

      <div class="field">
        <label>Texto / Conteúdo</label>
        <textarea id="p-text" rows="2">${escapeHTML(properties.text || '')}</textarea>
      </div>

      <div class="field-grid">
        <div class="field">
          <label>Fundo</label>
          <input type="color" id="p-bg"
            value="${this.colorValue(properties.backgroundColor, '#111827')}">
        </div>

        <div class="field">
          <label>Texto</label>
          <input type="color" id="p-fg"
            value="${this.colorValue(properties.textColor, '#ffffff')}">
        </div>
      </div>

      <div class="field-grid">
        <div class="field">
          <label>Raio da borda</label>
          <input type="number" min="0" max="100"
            id="p-radius"
            value="${properties.borderRadius ?? 8}">
        </div>

        <div class="field">
          <label>Tamanho fonte</label>
          <input type="number" min="8" max="72"
            id="p-font"
            value="${properties.fontSize ?? 13}">
        </div>
      </div>

      <label style="
        display:flex;
        align-items:center;
        gap:8px;
        font-size:12px;
        margin:8px 0 16px
      ">
        <input
          type="checkbox"
          id="p-visible"
          ${properties.visible !== false ? 'checked' : ''}
        >
        Visível
      </label>

      <button
        class="btn danger"
        id="delete-node"
        style="width:100%"
      >
        ⌫ Excluir objeto
      </button>
    `;

    const fields = {
      name: ['p-name', (value) => {
        node.name = value;
      }],

      positionX: ['p-x', (value) => {
        properties.positionX = Number(value) || 0;
      }],

      positionY: ['p-y', (value) => {
        properties.positionY = Number(value) || 0;
      }],

      width: ['p-w', (value) => {
        properties.width = Math.max(1, Number(value) || 1);
      }],

      height: ['p-h', (value) => {
        properties.height = Math.max(1, Number(value) || 1);
      }],

      text: ['p-text', (value) => {
        properties.text = value;
      }],

      backgroundColor: ['p-bg', (value) => {
        properties.backgroundColor = value;
      }],

      textColor: ['p-fg', (value) => {
        properties.textColor = value;
      }],

      borderRadius: ['p-radius', (value) => {
        properties.borderRadius = Math.max(0, Number(value) || 0);
      }],

      fontSize: ['p-font', (value) => {
        properties.fontSize = Math.max(8, Number(value) || 8);
      }]
    };

    Object.values(fields).forEach(([id, setter]) => {
      const input = $(id);

      input.oninput = (event) => {
        setter(event.target.value);

        if (id === 'p-name') {
          this.renderTree();
        }

        this.renderCanvas();
        this.scheduleSave();
      };
    });

    $('p-visible').onchange = (event) => {
      properties.visible = event.target.checked;
      this.renderCanvas();
      this.scheduleSave();
    };

    $('delete-node').onclick = () => {
      this.deleteSelected();
    };
  }

  colorValue(
