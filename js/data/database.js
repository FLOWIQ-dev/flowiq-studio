import { Scene } from './model.js';

const DB_NAME = 'flowiq-studio-next';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no armazenamento.'));
  });
}

export class Database {
  #dbPromise = null;

  async open() {
    if (this.#dbPromise) return this.#dbPromise;
    this.#dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis)) return reject(new Error('Este navegador não oferece armazenamento local.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECTS)) {
          const store = db.createObjectStore(PROJECTS, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.#dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { this.#dbPromise = null; reject(request.error || new Error('Não foi possível iniciar o banco local.')); };
      request.onblocked = () => reject(new Error('Feche outras abas do Flowiq Studio e tente novamente.'));
    });
    return this.#dbPromise;
  }

  async #run(stores, mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      try { result = operation(tx); }
      catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Transação não concluída.'));
      tx.onabort = () => reject(tx.error || new Error('Transação cancelada.'));
    });
  }

  async listProjects() {
    const db = await this.open();
    const tx = db.transaction(PROJECTS, 'readonly');
    const rows = await requestResult(tx.objectStore(PROJECTS).getAll());
    return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async getProject(id) {
    const db = await this.open();
    const tx = db.transaction(PROJECTS, 'readonly');
    return (await requestResult(tx.objectStore(PROJECTS).get(id))) || null;
  }

  saveProject(project) {
    if (!project?.id || !project?.name || !Array.isArray(project.scene)) throw new Error('Projeto incompleto.');
    const record = { ...project, name: String(project.name).trim().slice(0, 64), updatedAt: new Date().toISOString() };
    return this.#run(PROJECTS, 'readwrite', tx => tx.objectStore(PROJECTS).put(record));
  }

  deleteProject(id) {
    return this.#run(PROJECTS, 'readwrite', tx => tx.objectStore(PROJECTS).delete(id));
  }

  async listAssets() {
    const db = await this.open();
    const tx = db.transaction(ASSETS, 'readonly');
    return requestResult(tx.objectStore(ASSETS).getAll());
  }

  saveAsset(asset) {
    if (!asset?.id || !(asset.blob instanceof Blob)) throw new Error('Arquivo inválido.');
    const record = { id: asset.id, name: String(asset.name || 'Arquivo').slice(0, 180), mime: asset.blob.type || 'application/octet-stream', size: asset.blob.size, createdAt: new Date().toISOString(), blob: asset.blob };
    return this.#run(ASSETS, 'readwrite', tx => tx.objectStore(ASSETS).put(record));
  }

  deleteAsset(id) {
    return this.#run(ASSETS, 'readwrite', tx => tx.objectStore(ASSETS).delete(id));
  }

  async exportAll() {
    const [projects, assets] = await Promise.all([this.listProjects(), this.listAssets()]);
    const encoded = [];
    let total = 0;
    for (const asset of assets) {
      if (asset.size > 12 * 1024 * 1024) throw new Error('O arquivo ' + asset.name + ' excede 12 MB.');
      total += asset.size;
      if (total > 24 * 1024 * 1024) throw new Error('A biblioteca excede o limite de exportação móvel de 24 MB.');
      const bytes = new Uint8Array(await asset.blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      encoded.push({ id: asset.id, name: asset.name, mime: asset.mime, data: btoa(binary) });
    }
    const core = { format: 'flowiq-studio-next', version: 1, exportedAt: new Date().toISOString(), projects, assets: encoded };
    if (!crypto.subtle) throw new Error('Este navegador não oferece verificação de integridade.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(core)));
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return new Blob([JSON.stringify({ ...core, integrity: { algorithm: 'SHA-256', digest: checksum } })], { type: 'application/vnd.flowiq.backup+json' });
  }

  async importAll(file) {
    if (!(file instanceof Blob) || file.size < 2 || file.size > 40 * 1024 * 1024) throw new Error('Arquivo de backup vazio ou acima de 40 MB.');
    let data;
    try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('O arquivo não contém um backup válido.'); }
    if (data?.format !== 'flowiq-studio-next' || data.version !== 1 || !Array.isArray(data.projects) || !Array.isArray(data.assets)) throw new Error('Formato de backup não reconhecido.');
    const core = { format: data.format, version: data.version, exportedAt: data.exportedAt, projects: data.projects, assets: data.assets };
    if (!crypto.subtle || data.integrity?.algorithm !== 'SHA-256') throw new Error('O backup não possui verificação de integridade.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(core)));
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (checksum !== data.integrity.digest) throw new Error('A verificação de integridade do backup falhou.');
    if (data.projects.length > 300 || data.assets.length > 3000) throw new Error('O backup ultrapassa os limites do Studio.');
    const projects = data.projects.map(project => {
      if (!project?.id || !project?.name || !Array.isArray(project.scene)) throw new Error('Um projeto do backup está inválido.');
      new Scene(project.scene);
      if (project.events != null && !Array.isArray(project.events)) throw new Error('Eventos do projeto inválidos.');
      return { ...project, id: crypto.randomUUID(), name: String(project.name).slice(0, 64), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    });
    const assetIds = new Map();
    const assets = data.assets.map(asset => {
      if (!asset?.id || typeof asset.data !== 'string' || asset.data.length > 20 * 1024 * 1024) throw new Error('Um arquivo do backup está inválido.');
      const binary = atob(asset.data);
      if (binary.length > 12 * 1024 * 1024) throw new Error('Um arquivo ultrapassa 12 MB.');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const id = crypto.randomUUID();
      assetIds.set(asset.id, id);
      return { id, name: String(asset.name || 'Arquivo').slice(0, 180), blob: new Blob([bytes], { type: String(asset.mime || 'application/octet-stream') }) };
    });
    const rewriteAssets = value => {
      if (Array.isArray(value)) return value.map(rewriteAssets);
      if (!value || typeof value !== 'object') return value;
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = key === 'assetId' && typeof item === 'string' ? (assetIds.get(item) || '') : rewriteAssets(item);
      return out;
    };
    const normalizedProjects = projects.map(project => rewriteAssets(project));
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS, ASSETS], 'readwrite');
      const p = tx.objectStore(PROJECTS), a = tx.objectStore(ASSETS);
      normalizedProjects.forEach(item => p.add(item));
      assets.forEach(item => a.add({ ...item, mime: item.blob.type, size: item.blob.size, createdAt: new Date().toISOString() }));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível restaurar o backup.'));
      tx.onabort = () => reject(tx.error || new Error('Restauração cancelada.'));
    });
    return { projects: projects.length, assets: assets.length };
  }

  close() { this.#dbPromise?.then(db => db.close()).catch(() => {}); this.#dbPromise = null; }
}
