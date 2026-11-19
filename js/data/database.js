import { Scene } from './model.js';

const DB_NAME = 'flowiq-studio-next';
const DB_VERSION = 2;
const PROJECTS = 'projects';
const ASSETS = 'assets';
const VERSIONS = 'versions';
const MAX_VERSIONS = 30;
const AUTO_VERSION_INTERVAL = 5 * 60 * 1000;
const makeId = () => globalThis.crypto?.randomUUID?.() || 'import_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

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
        if (!db.objectStoreNames.contains(VERSIONS)) {
          const versions = db.createObjectStore(VERSIONS, { keyPath: 'id' });
          versions.createIndex('projectId', 'projectId', { unique: false });
          versions.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.#dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { this.#dbPromise = null; reject(request.error || new Error('Não foi possível iniciar o banco local.')); };
      request.onblocked = () => { this.#dbPromise = null; reject(new Error('Feche outras abas do Flowiq Studio e tente novamente.')); };
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

  async #pruneVersions(store, projectId, rows) {
    const sorted = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const old of sorted.slice(MAX_VERSIONS)) store.delete(old.id);
  }

  async saveProject(project) {
    if (!project?.id || !project?.name || !Array.isArray(project.scene)) throw new Error('Projeto incompleto.');
    const record = { ...project, name: String(project.name).trim().slice(0, 64), updatedAt: new Date().toISOString() };
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS, VERSIONS], 'readwrite');
      const projects = tx.objectStore(PROJECTS);
      const versions = tx.objectStore(VERSIONS);
      const request = projects.get(record.id);
      request.onsuccess = () => {
        const previous = request.result;
        if (previous) {
          const comparable = value => {
            const copy = { ...value };
            delete copy.updatedAt;
            return JSON.stringify(copy);
          };
          if (comparable(previous) !== comparable(record)) {
            const index = versions.index('projectId');
            const historyRequest = index.getAll(record.id);
            historyRequest.onsuccess = () => {
              const rows = historyRequest.result || [];
              const newest = rows.reduce((value, item) => Math.max(value, Date.parse(item.createdAt) || 0), 0);
              if (!newest || Date.now() - newest >= AUTO_VERSION_INTERVAL) {
                const version = {
                  id: makeId(), projectId: record.id, kind: 'automatic',
                  note: 'Salvamento automático', createdAt: new Date().toISOString(),
                  snapshot: previous
                };
                versions.add(version);
                this.#pruneVersions(versions, record.id, [...rows, version]);
              }
            };
          }
        }
        projects.put(record);
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error || new Error('Não foi possível salvar o projeto com segurança.'));
      tx.onabort = () => reject(tx.error || new Error('Salvamento cancelado. O projeto anterior foi preservado.'));
    });
  }

  async createVersion(project, { kind = 'manual', note = '' } = {}) {
    if (!project?.id || !project?.name || !Array.isArray(project.scene)) throw new Error('Projeto incompleto.');
    const db = await this.open();
    const version = {
      id: makeId(), projectId: project.id, kind,
      note: String(note || '').slice(0, 120),
      createdAt: new Date().toISOString(),
      snapshot: JSON.parse(JSON.stringify(project))
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VERSIONS, 'readwrite');
      const store = tx.objectStore(VERSIONS);
      const request = store.index('projectId').getAll(project.id);
      request.onsuccess = () => {
        store.add(version);
        this.#pruneVersions(store, project.id, [...request.result, version]);
      };
      tx.oncomplete = () => resolve(version);
      tx.onerror = () => reject(tx.error || new Error('Não foi possível criar o ponto de restauração.'));
      tx.onabort = () => reject(tx.error || new Error('Criação do ponto de restauração cancelada.'));
    });
  }

  async listVersions(projectId) {
    const db = await this.open();
    const tx = db.transaction(VERSIONS, 'readonly');
    const rows = await requestResult(tx.objectStore(VERSIONS).index('projectId').getAll(projectId));
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async restoreVersion(projectId, versionId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS, VERSIONS], 'readwrite');
      const projects = tx.objectStore(PROJECTS);
      const versions = tx.objectStore(VERSIONS);
      let current, selected, loaded = 0;
      const ready = () => {
        loaded += 1;
        if (loaded !== 2) return;
        if (!current || !selected || selected.projectId !== projectId || !selected.snapshot) {
          tx.abort();
          reject(new Error('Esta versão não está disponível.'));
          return;
        }
        try {
          const restored = { ...selected.snapshot, id: projectId, updatedAt: new Date().toISOString() };
          new Scene(restored.scene);
          if (!restored.name || !Array.isArray(restored.scene)) throw new Error('Versão inválida.');
          versions.add({
            id: makeId(), projectId, kind: 'pre-restore',
            note: 'Estado anterior à restauração', createdAt: new Date().toISOString(),
            snapshot: current
          });
          projects.put(restored);
          const historyRequest = versions.index('projectId').getAll(projectId);
          historyRequest.onsuccess = () => this.#pruneVersions(versions, projectId, historyRequest.result || []);
          resolveAfterCommit = restored;
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      let resolveAfterCommit = null;
      projects.get(projectId).onsuccess = event => { current = event.target.result; ready(); };
      versions.get(versionId).onsuccess = event => { selected = event.target.result; ready(); };
      tx.oncomplete = () => resolve(resolveAfterCommit);
      tx.onerror = () => reject(tx.error || new Error('A restauração falhou. A versão atual foi preservada.'));
      tx.onabort = () => reject(tx.error || new Error('A restauração foi cancelada.'));
    });
  }

  async deleteProject(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS, VERSIONS], 'readwrite');
      tx.objectStore(PROJECTS).delete(id);
      const request = tx.objectStore(VERSIONS).index('projectId').getAll(id);
      request.onsuccess = () => request.result.forEach(version => tx.objectStore(VERSIONS).delete(version.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível excluir o projeto.'));
      tx.onabort = () => reject(tx.error || new Error('Exclusão cancelada.'));
    });
  }

  async requestPersistentStorage() {
    try {
      if (!navigator.storage?.persist) return false;
      return await navigator.storage.persist();
    } catch { return false; }
  }

  async getStorageEstimate() {
    try { return await navigator.storage?.estimate?.() || null; }
    catch { return null; }
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

  async renameAsset(id, name) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSETS, 'readwrite');
      const store = tx.objectStore(ASSETS);
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) { tx.abort(); reject(new Error('Arquivo não encontrado.')); return; }
        store.put({ ...request.result, name: String(name || 'Arquivo').trim().slice(0, 180) || 'Arquivo' });
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível renomear o arquivo.'));
      tx.onabort = () => reject(tx.error || new Error('Renomeação cancelada.'));
    });
  }

  deleteAsset(id) {
    return this.#run(ASSETS, 'readwrite', tx => tx.objectStore(ASSETS).delete(id));
  }

  async exportAll() {
    const [projects, assets] = await Promise.all([this.listProjects(), this.listAssets()]);
    const versions = (await Promise.all(projects.map(project => this.listVersions(project.id)))).flat();
    if (projects.length > 300 || assets.length > 3000) throw new Error('A quantidade de itens excede o limite do backup.');
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
    const core = { format: 'flowiq-studio-next', version: 2, exportedAt: new Date().toISOString(), projects, assets: encoded, versions };
    if (!crypto.subtle) throw new Error('Este navegador não oferece verificação de integridade.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(core)));
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const backup = new Blob([JSON.stringify({ ...core, integrity: { algorithm: 'SHA-256', digest: checksum } })], { type: 'application/vnd.flowiq.backup+json' });
    if (backup.size > 40 * 1024 * 1024) throw new Error('O backup ultrapassa 40 MB. Reduza a biblioteca e tente novamente.');
    return backup;
  }

  async importAll(file) {
    if (!(file instanceof Blob) || file.size < 2 || file.size > 40 * 1024 * 1024) throw new Error('Arquivo de backup vazio ou acima de 40 MB.');
    let data;
    try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('O arquivo não contém um backup válido.'); }
    if (data?.format !== 'flowiq-studio-next' || ![1, 2].includes(data.version) || !Array.isArray(data.projects) || !Array.isArray(data.assets) || (data.version === 2 && !Array.isArray(data.versions))) throw new Error('Formato de backup não reconhecido.');
    const core = data.version === 2
      ? { format: data.format, version: data.version, exportedAt: data.exportedAt, projects: data.projects, assets: data.assets, versions: data.versions }
      : { format: data.format, version: data.version, exportedAt: data.exportedAt, projects: data.projects, assets: data.assets };
    if (!crypto.subtle || data.integrity?.algorithm !== 'SHA-256') throw new Error('O backup não possui verificação de integridade.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(core)));
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (checksum !== data.integrity.digest) throw new Error('A verificação de integridade do backup falhou.');
    if (data.projects.length > 300 || data.assets.length > 3000) throw new Error('O backup ultrapassa os limites do Studio.');
    const projectIds = new Map();
    const projects = data.projects.map(project => {
      if (!project?.id || !project?.name || !Array.isArray(project.scene)) throw new Error('Um projeto do backup está inválido.');
      new Scene(project.scene);
      const importedId = makeId();
      projectIds.set(project.id, importedId);
      if (project.events != null && !Array.isArray(project.events)) throw new Error('Eventos do projeto inválidos.');
      return { ...project, id: importedId, name: String(project.name).slice(0, 64), events: Array.isArray(project.events) ? project.events.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [], scripts: Array.isArray(project.scripts) ? project.scripts.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [], animations: Array.isArray(project.animations) ? project.animations.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [], settings: project.settings && typeof project.settings === 'object' && !Array.isArray(project.settings) ? project.settings : {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    });
    const assetIds = new Map();
    const seenAssetIds = new Set();
    const assets = data.assets.map(asset => {
      if (seenAssetIds.has(asset?.id)) throw new Error('O backup contém identificadores de arquivos duplicados.');
      seenAssetIds.add(asset?.id);
      if (!asset?.id || typeof asset.data !== 'string' || asset.data.length > 20 * 1024 * 1024) throw new Error('Um arquivo do backup está inválido.');
      const binary = atob(asset.data);
      if (binary.length > 12 * 1024 * 1024) throw new Error('Um arquivo ultrapassa 12 MB.');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const id = makeId();
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
    const versions = (data.versions || []).map(version => {
      const projectId = projectIds.get(version?.projectId);
      if (!projectId || !version?.snapshot || !Array.isArray(version.snapshot.scene)) throw new Error('Uma versão do histórico está inválida.');
      new Scene(version.snapshot.scene);
      return {
        id: makeId(), projectId, kind: String(version.kind || 'imported').slice(0, 32),
        note: String(version.note || 'Versão importada').slice(0, 120),
        createdAt: new Date(version.createdAt || Date.now()).toISOString(),
        snapshot: rewriteAssets({ ...version.snapshot, id: projectId })
      };
    });
    if (versions.length > data.projects.length * MAX_VERSIONS) throw new Error('O backup contém versões demais.');
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS, ASSETS, VERSIONS], 'readwrite');
      const p = tx.objectStore(PROJECTS), a = tx.objectStore(ASSETS), v = tx.objectStore(VERSIONS);
      normalizedProjects.forEach(item => p.add(item));
      assets.forEach(item => a.add({ ...item, mime: item.blob.type, size: item.blob.size, createdAt: new Date().toISOString() }));
      versions.forEach(item => v.add(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível restaurar o backup.'));
      tx.onabort = () => reject(tx.error || new Error('Restauração cancelada.'));
    });
    return { projects: projects.length, assets: assets.length, versions: versions.length };
  }

  close() { this.#dbPromise?.then(db => db.close()).catch(() => {}); this.#dbPromise = null; }
}
