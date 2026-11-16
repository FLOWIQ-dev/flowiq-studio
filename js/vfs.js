
const DB_NAME = 'flowiq-studio';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

export class VirtualFS {
  constructor() {
    this.dbPromise = null;
  }

  openDB() {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis)) {
        reject(new Error('Este navegador não oferece suporte ao IndexedDB.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id'
          });

          store.createIndex('updatedAt', 'updatedAt', {
            unique: false
          });
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Falha ao abrir o banco de dados.'));
      };

      request.onblocked = () => {
        reject(new Error(
          'O banco está ocupado por outra aba. Feche outras abas do Studio e tente novamente.'
        ));
      };
    });

    return this.dbPromise;
  }

  async transaction(mode, operation) {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);

      let result;

      try {
        result = operation(store);
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(
        tx.error || new Error('Erro na operação do banco de dados.')
      );
      tx.onabort = () => reject(
        tx.error || new Error('Operação cancelada.')
      );
    });
  }

  async getProjects() {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();

      request.onsuccess = () => {
        const projects = request.result || [];

        projects.sort((a, b) =>
          new Date(b.updatedAt || 0) -
          new Date(a.updatedAt || 0)
        );

        resolve(projects);
      };

      request.onerror = () => {
        reject(request.error || new Error('Não foi possível listar projetos.'));
      };
    });
  }

  async getProject(id) {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);

      request.onsuccess = () => resolve(request.result || null);

      request.onerror = () => {
        reject(request.error || new Error('Não foi possível abrir o projeto.'));
      };
    });
  }

  async saveProject(project) {
    if (!project || typeof project !== 'object') {
      throw new Error('Projeto inválido.');
    }

    if (!project.id || typeof project.id !== 'string') {
      throw new Error('O projeto precisa ter um identificador válido.');
    }

    if (!project.name || typeof project.name !== 'string') {
      throw new Error('O projeto precisa ter um nome.');
    }

    if (!Array.isArray(project.data)) {
      throw new Error('Os dados do projeto precisam ser uma lista.');
    }

    const record = {
      id: project.id,
      name: project.name.trim().slice(0, 64),
      updatedAt: project.updatedAt || new Date().toISOString(),
      data: project.data
    };

    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const request = tx.objectStore(STORE_NAME).put(record);

      request.onerror = () => {
        reject(request.error || new Error('Falha ao salvar projeto.'));
      };

      tx.oncomplete = () => resolve(record);

      tx.onerror = () => {
        reject(tx.error || new Error('Falha ao concluir o salvamento.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('Salvamento cancelado.'));
      };
    });
  }

  async deleteProject(id) {
    if (!id) {
      throw new Error('Identificador do projeto não informado.');
    }

    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const request = tx.objectStore(STORE_NAME).delete(id);

      request.onerror = () => {
        reject(request.error || new Error('Falha ao excluir projeto.'));
      };

      tx.oncomplete = () => resolve(true);

      tx.onerror = () => {
        reject(tx.error || new Error('Falha ao concluir a exclusão.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('Exclusão cancelada.'));
      };
    });
  }

  async clear() {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const request = tx.objectStore(STORE_NAME).clear();

      request.onerror = () => {
        reject(request.error || new Error('Falha ao limpar projetos.'));
      };

      tx.oncomplete = () => resolve(true);

      tx.onerror = () => {
        reject(tx.error || new Error('Falha ao concluir a limpeza.'));
      };
    });
  }

  async count() {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).count();

      request.onsuccess = () => resolve(request.result);

      request.onerror = () => {
        reject(request.error || new Error('Falha ao contar projetos.'));
      };
    });
  }

  close() {
    if (!this.dbPromise) return;

    this.dbPromise.then((db) => db.close()).catch(() => {});
    this.dbPromise = null;
  }
}
