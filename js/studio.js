import { DataModel, Instance } from './datamodel.js';
import { VirtualFS } from './vfs.js';

class StudioApp {
    constructor() {
        this.vfs = new VirtualFS();
        this.datamodel = new DataModel();
        this.currentProjectId = null;
        this.currentProjectName = '';
        this.selectedInstance = null;
        this.init();
    }

    async init() {
        await this.loadHubProjects();
        this.setupEvents();
        lucide.createIcons();
    }

    async loadHubProjects() {
        const listContainer = document.getElementById('hub-project-list');
        const projects = await this.vfs.getProjects();

        if (projects.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center py-10 text-slate-500 text-xs flex flex-col items-center gap-2">
                    <i data-lucide="folder-open" class="w-8 h-8 opacity-40"></i>
                    Nenhum projeto encontrado. Crie o primeiro acima!
                </div>
            `;
            lucide.createIcons();
            return;
        }

        listContainer.innerHTML = projects.map(p => `
            <div class="bg-slate-950/60 border border-slate-800 hover:border-indigo-500/50 p-3.5 rounded-xl flex justify-between items-center transition group">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                        <i data-lucide="cpu" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <h4 class="font-semibold text-sm text-slate-200">${p.name}</h4>
                        <span class="text-[10px] text-slate-500">Atualizado: ${new Date(p.updatedAt).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button class="btn-open-proj bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1" data-id="${p.id}">
                        <i data-lucide="folder-open" class="w-3.5 h-3.5"></i> Abrir
                    </button>
                    <button class="btn-del-proj text-slate-500 hover:text-red-400 p-1.5 rounded-lg transition" data-id="${p.id}" title="Excluir">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `).join('');
        lucide.createIcons();

        listContainer.querySelectorAll('.btn-open-proj').forEach(btn => {
            btn.onclick = () => this.openProject(btn.dataset.id);
        });
        listContainer.querySelectorAll('.btn-del-proj').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('Deseja excluir este projeto permanentemente?')) {
                    await this.vfs.deleteProject(btn.dataset.id);
                    this.loadHubProjects();
                }
            };
        });
    }

    setupEvents() {
        document.getElementById('btn-new-project').onclick = async () => {
            const name = prompt('Nome do seu Sistema Operacional (ex: NeoOS):', 'MeuOS');
            if (!name) return;

            const newProj = {
                id: 'proj_' + Math.random().toString(36).substr(2, 9),
                name: name,
                updatedAt: new Date().toISOString(),
                data: []
            };

            const defaultGui = new Instance('ScreenGui', 'MainScreen');
            const defaultFrame = new Instance('Frame', 'AppWindow');
            defaultFrame.setParent(defaultGui);
            newProj.data = defaultGui.toJSON();

            await this.vfs.saveProject(newProj);
            this.openProject(newProj.id);
        };

        document.getElementById('btn-back').onclick = () => this.switchToHub();

        document.getElementById('btn-save').onclick = async () => {
            if (!this.currentProjectId) return;
            const projectData = {
                id: this.currentProjectId,
                name: this.currentProjectName,
                updatedAt: new Date().toISOString(),
                data: this.datamodel.root.children.map(c => c.toJSON())
            };
            await this.vfs.saveProject(projectData);
            alert('Projeto salvo com sucesso no IndexedDB!');
        };

        document.getElementById('btn-add-frame').onclick = () => {
            const inst = new Instance('Frame', 'Frame_' + Math.floor(Math.random()*100));
            const target = this.selectedInstance || this.datamodel.root;
            inst.setParent(target);
            this.refreshWorkspace();
        };

        document.getElementById('btn-add-button').onclick = () => {
            const inst = new Instance('TextButton', 'Button_' + Math.floor(Math.random()*100));
            const target = this.selectedInstance || this.datamodel.root;
            inst.setParent(target);
            this.refreshWorkspace();
        };

        document.getElementById('btn-play').onclick = () => {
            alert('Modo Simulação OS ativado!');
        };
    }

    async openProject(id) {
        const projects = await this.vfs.getProjects();
        const proj = projects.find(p => p.id === id);
        if (!proj) return;

        this.currentProjectId = proj.id;
        this.currentProjectName = proj.name;
        this.datamodel.loadFromJSON(proj.data || []);
        this.selectedInstance = this.datamodel.root.children[0] || null;

        document.getElementById('view-hub').classList.add('hidden');
        document.getElementById('view-workspace').classList.remove('hidden');
        document.getElementById('btn-back').classList.remove('hidden');
        document.getElementById('btn-save').classList.remove('hidden');
        document.getElementById('btn-play').classList.remove('hidden');

        this.refreshWorkspace();
    }

    switchToHub() {
        this.currentProjectId = null;
        document.getElementById('view-workspace').classList.add('hidden');
        document.getElementById('view-hub').classList.remove('hidden');
        document.getElementById('btn-back').classList.add('hidden');
        document.getElementById('btn-save').classList.add('hidden');
        document.getElementById('btn-play').classList.add('hidden');
        this.loadHubProjects();
    }

    refreshWorkspace() {
        this.renderExplorer();
        this.renderViewport();
        this.renderProperties();
        lucide.createIcons();
    }

    renderExplorer() {
        const tree = document.getElementById('explorer-tree');
        tree.innerHTML = '';
        this.renderNodeRecursive(this.datamodel.root, tree, 0);
    }

    renderNodeRecursive(instance, container, depth) {
        const isSelected = this.selectedInstance === instance;
        const div = document.createElement('div');
        div.className = `flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer text-xs transition ${isSelected ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-slate-300 hover:bg-slate-800/80'}`;
        div.style.paddingLeft = `${depth * 14 + 8}px`;

        let iconName = 'folder';
        if (instance.className === 'Frame') iconName = 'square';
        if (instance.className === 'TextButton') iconName = 'mouse-pointer-click';
        if (instance.className === 'ScreenGui') iconName = 'monitor';

        div.innerHTML = `
            <div class="flex items-center gap-2 truncate">
                <i data-lucide="${iconName}" class="w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-indigo-400'}"></i>
                <span class="truncate">${instance.name}</span>
            </div>
        `;

        div.onclick = (e) => {
            e.stopPropagation();
            this.selectedInstance = instance;
            this.refreshWorkspace();
        };

        container.appendChild(div);

        instance.children.forEach(child => {
            this.renderNodeRecursive(child, container, depth + 1);
        });
    }

    renderViewport() {
        const canvas = document.getElementById('viewport-canvas');
        canvas.innerHTML = '';

        this.datamodel.root.children.forEach(screen => {
            screen.children.forEach(el => {
                const domEl = document.createElement('div');
                domEl.className = `absolute rounded-xl shadow-lg flex items-center justify-center text-xs font-semibold cursor-pointer transition-all ${this.selectedInstance === el ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-950' : ''}`;
                domEl.style.left = `${el.properties.positionX}px`;
                domEl.style.top = `${el.properties.positionY}px`;
                domEl.style.width = `${el.properties.width}px`;
                domEl.style.height = `${el.properties.height}px`;
                domEl.style.backgroundColor = el.properties.backgroundColor;
                domEl.style.color = el.properties.textColor;

                domEl.innerText = el.className === 'TextButton' ? el.properties.text : el.name;

                domEl.onclick = (e) => {
                    e.stopPropagation();
                    this.selectedInstance = el;
                    this.refreshWorkspace();
                };

                canvas.appendChild(domEl);
            });
        });

        if (canvas.children.length === 0) {
            canvas.innerHTML = `
                <div class="text-center text-slate-600 text-xs flex flex-col items-center gap-2">
                    <i data-lucide="layout" class="w-6 h-6 opacity-40"></i>
                    Palco Vazio (Adicione elementos no Explorer)
                </div>
            `;
        }
    }

    renderProperties() {
        const container = document.getElementById('properties-content');
        if (!this.selectedInstance || this.selectedInstance === this.datamodel.root) {
            container.innerHTML = `
                <div class="text-slate-500 text-xs text-center py-10 flex flex-col items-center gap-2">
                    <i data-lucide="mouse-pointer" class="w-6 h-6 opacity-40"></i>
                    Selecione um objeto para editar.
                </div>
            `;
            return;
        }

        const inst = this.selectedInstance;
        container.innerHTML = `
            <div class="space-y-4">
                <div>
                    <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Nome</label>
                    <input type="text" id="prop-name" value="${inst.name}" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500">
                </div>
                <div>
                    <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Classe</label>
                    <input type="text" disabled value="${inst.className}" class="w-full bg-slate-950/40 border border-slate-800 rounded-lg p-2 text-xs text-slate-500 cursor-not-allowed">
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Pos X (px)</label>
                        <input type="number" id="prop-x" value="${inst.properties.positionX}" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none">
                    </div>
                    <div>
                        <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Pos Y (px)</label>
                        <input type="number" id="prop-y" value="${inst.properties.positionY}" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Largura</label>
                        <input type="number" id="prop-w" value="${inst.properties.width}" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none">
                    </div>
                    <div>
                        <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Altura</label>
                        <input type="number" id="prop-h" value="${inst.properties.height}" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none">
                    </div>
                </div>
                <div>
                    <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Cor de Fundo</label>
                    <input type="color" id="prop-bg" value="${inst.properties.backgroundColor}" class="w-full h-9 bg-slate-950 border border-slate-800 rounded-lg p-1 cursor-pointer">
                </div>
                ${inst.className === 'TextButton' ? `
                <div>
                    <label class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Texto do Botão</label>
                    <input type="text" id="prop-text" value="${inst.properties.text}" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none">
                </div>
                ` : ''}
                <div class="pt-4 border-t border-slate-800">
                    <button id="btn-delete-inst" class="w-full bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white py-2 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5">
                        <i data-lucide="trash-2" class="w-4 h-4"></i> Excluir Objeto
                    </button>
                </div>
            </div>
        `;

        document.getElementById('prop-name').oninput = (e) => { inst.name = e.target.value; this.renderExplorer(); };
        document.getElementById('prop-x').oninput = (e) => { inst.properties.positionX = parseInt(e.target.value) || 0; this.renderViewport(); };
        document.getElementById('prop-y').oninput = (e) => { inst.properties.positionY = parseInt(e.target.value) || 0; this.renderViewport(); };
        document.getElementById('prop-w').oninput = (e) => { inst.properties.width = parseInt(e.target.value) || 10; this.renderViewport(); };
        document.getElementById('prop-h').oninput = (e) => { inst.properties.height = parseInt(e.target.value) || 10; this.renderViewport(); };
        document.getElementById('prop-bg').oninput = (e) => { inst.properties.backgroundColor = e.target.value; this.renderViewport(); };
        if (inst.className === 'TextButton') {
            document.getElementById('prop-text').oninput = (e) => { inst.properties.text = e.target.value; this.renderViewport(); };
        }
        document.getElementById('btn-delete-inst').onclick = () => {
            if (confirm(`Deseja excluir "${inst.name}"?`)) {
                inst.destroy();
                this.selectedInstance = null;
                this.refreshWorkspace();
            }
        };
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new StudioApp();
});
            
