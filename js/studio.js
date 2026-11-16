import { Instance } from './datamodel.js';
import { VFS } from './vfs.js';

let currentProject = null;
let selectedInstance = null;

async function initStudio() {
    await renderProjectList();

    document.getElementById('newProjectBtn').onclick = async () => {
        const name = prompt("Nome do Sistema Operacional (ex: NeoOS):", "NeoOS");
        if (!name) return;

        const root = new Instance('ScreenRoot', 'ScreenRoot');
        const bg = new Instance('Frame', 'Background');
        bg.properties.backgroundColor = '#1e293b';
        bg.properties.width = '100%';
        bg.properties.height = '100%';
        bg.properties.top = '0px';
        bg.properties.left = '0px';
        bg.setParent(root);

        const newProj = {
            id: Date.now(),
            name: name,
            created: new Date().toLocaleDateString(),
            rootData: root.toJSON()
        };

        await VFS.saveProject(newProj);
        openProject(newProj);
    };

    document.getElementById('backHubBtn').onclick = async () => {
        if (currentProject) {
            await saveActiveProject();
        }
        document.getElementById('workspaceScreen').classList.remove('active');
        document.getElementById('hubScreen').classList.add('active');
        await renderProjectList();
        closeDrawers();
    };

    document.getElementById('addFrameBtn').onclick = () => addInstanceToActive('Frame');
    document.getElementById('addButtonBtn').onclick = () => addInstanceToActive('TextButton');
}

async function renderProjectList() {
    const list = document.getElementById('projectList');
    const projects = await VFS.getAllProjects();

    if (projects.length === 0) {
        list.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 20px;">Nenhum projeto criado.</p>`;
        return;
    }

    list.innerHTML = projects.map(p => `
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 12px; border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong style="font-size: 0.85rem;">${p.name}</strong>
                <div style="font-size: 0.65rem; color: var(--text-muted);">Criado em: ${p.created}</div>
            </div>
            <div style="display: flex; gap: 6px;">
                <button class="btn" style="padding: 6px 12px; font-size: 0.75rem;" data-open="${p.id}">Abrir</button>
                <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.75rem; color: #ef4444;" data-del="${p.id}">🗑️</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('[data-open]').forEach(btn => {
        btn.onclick = async () => {
            const id = Number(btn.getAttribute('data-open'));
            const found = projects.find(p => p.id === id);
            if (found) openProject(found);
        };
    });

    list.querySelectorAll('[data-del]').forEach(btn => {
        btn.onclick = async () => {
            if (confirm("Deseja realmente excluir este projeto?")) {
                const id = Number(btn.getAttribute('data-del'));
                await VFS.deleteProject(id);
                renderProjectList();
            }
        };
    });
}

function openProject(projData) {
    currentProject = {
        ...projData,
        rootInstance: Instance.fromJSON(projData.rootData)
    };

    document.getElementById('currentProjectTitle').innerText = currentProject.name;
    document.getElementById('hubScreen').classList.remove('active');
    document.getElementById('workspaceScreen').classList.add('active');
    
    selectedInstance = currentProject.rootInstance;
    renderViewport();
    renderExplorerTree();
    renderInspector();
}

async function saveActiveProject() {
    if (!currentProject) return;
    currentProject.rootData = currentProject.rootInstance.toJSON();
    await VFS.saveProject({
        id: currentProject.id,
        name: currentProject.name,
        created: currentProject.created,
        rootData: currentProject.rootData
    });
}

function addInstanceToActive(className) {
    if (!currentProject) return;
    const name = className + "_" + (currentProject.rootInstance.children.length + 1);
    const inst = new Instance(className, name);
    inst.setParent(currentProject.rootInstance);
    
    saveActiveProject();
    renderViewport();
    renderExplorerTree();
    closeDrawers();
}

function renderViewport() {
    const viewport = document.getElementById('viewportCanvas');
    viewport.innerHTML = '';

    function renderNode(node) {
        if (node.className !== 'ScreenRoot') {
            const el = document.createElement('div');
            el.className = 'ui-element';
            el.style.backgroundColor = node.properties.backgroundColor;
            el.style.width = node.properties.width;
            el.style.height = node.properties.height;
            el.style.top = node.properties.top;
            el.style.left = node.properties.left;
            el.style.borderRadius = '6px';
            el.style.border = selectedInstance === node ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.2)';
            el.innerText = node.name;
            
            el.onclick = (e) => {
                e.stopPropagation();
                selectedInstance = node;
                renderViewport();
                renderInspector();
            };
            viewport.appendChild(el);
        }
        node.children.forEach(renderNode);
    }

    renderNode(currentProject.rootInstance);
}

function renderExplorerTree() {
    const tree = document.getElementById('instanceTree');
    
    function buildHTML(node, depth = 0) {
        let html = `
            <div class="tree-item" style="padding-left: ${depth * 14}px;" data-id="${node.id}">
                <span>📁 ${node.name} <small style="color:var(--text-muted);">(${node.className})</small></span>
            </div>
        `;
        node.children.forEach(child => {
            html += buildHTML(child, depth + 1);
        });
        return html;
    }

    tree.innerHTML = buildHTML(currentProject.rootInstance);

    tree.querySelectorAll('.tree-item').forEach(item => {
        item.onclick = () => {
            const id = item.getAttribute('data-id');
            selectedInstance = findNodeById(currentProject.rootInstance, id);
            renderViewport();
            renderInspector();
        };
    });
}

function findNodeById(node, id) {
    if (node.id === id) return node;
    for (let child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
    }
    return null;
}

function renderInspector() {
    const details = document.getElementById('propDetails');
    if (!selectedInstance) {
        details.innerHTML = "Nenhum nó selecionado.";
        return;
    }

    details.innerHTML = `
        <div style="margin-bottom: 8px;"><b>Nome:</b> <input type="text" id="propName" value="${selectedInstance.name}" style="background:var(--bg-base); color:white; border:1px solid var(--border-subtle); padding:4px; border-radius:4px; width:100%;"></div>
        <div style="margin-bottom: 8px;"><b>Tipo:</b> ${selectedInstance.className}</div>
        <div style="margin-bottom: 8px; display:flex; align-items:center; gap:8px;">
            <b>Cor:</b> <input type="color" id="propColor" value="${selectedInstance.properties.backgroundColor || '#3b82f6'}" style="background:none; border:none; width:35px; height:30px; cursor:pointer;">
        </div>
        <div style="margin-bottom: 8px;"><b>Altura:</b> <input type="text" id="propHeight" value="${selectedInstance.properties.height}" style="background:var(--bg-base); color:white; border:1px solid var(--border-subtle); padding:4px; border-radius:4px; width:100%;"></div>
    `;

    document.getElementById('propName').oninput = (e) => {
        selectedInstance.name = e.target.value;
        saveActiveProject();
        renderExplorerTree();
        renderViewport();
    };

    document.getElementById('propColor').oninput = (e) => {
        selectedInstance.properties.backgroundColor = e.target.value;
        saveActiveProject();
        renderViewport();
    };

    document.getElementById('propHeight').oninput = (e) => {
        selectedInstance.properties.height = e.target.value;
        saveActiveProject();
        renderViewport();
    };
}

function toggleDrawer(drawerId) {
    document.querySelectorAll('.studio-drawer').forEach(d => {
        if (d.id === drawerId) {
            d.classList.toggle('open');
        } else {
            d.classList.remove('open');
        }
    });
}

function closeDrawers() {
    document.querySelectorAll('.studio-drawer').forEach(d => d.classList.remove('open'));
}

window.FlowiqStudio = { toggleDrawer, closeDrawers };
initStudio();

