
const DEFAULT_PROPERTIES = {
  Frame: {
    positionX: 20,
    positionY: 20,
    width: 300,
    height: 220,
    backgroundColor: '#182235',
    borderRadius: 12,
    visible: true
  },

  TextButton: {
    positionX: 20,
    positionY: 20,
    width: 150,
    height: 44,
    backgroundColor: '#2563eb',
    textColor: '#ffffff',
    borderRadius: 9,
    fontSize: 14,
    text: 'Botão',
    visible: true
  },

  TextLabel: {
    positionX: 20,
    positionY: 20,
    width: 180,
    height: 32,
    backgroundColor: '#00000000',
    textColor: '#ffffff',
    borderRadius: 0,
    fontSize: 14,
    text: 'Texto',
    visible: true
  },

  ImageLabel: {
    positionX: 20,
    positionY: 20,
    width: 120,
    height: 120,
    backgroundColor: '#263449',
    borderRadius: 8,
    text: 'Imagem',
    visible: true
  }
};

function createId() {
  return globalThis.crypto?.randomUUID?.() ||
    'node_' + Date.now() + '_' +
    Math.random().toString(36).slice(2);
}

function safeName(value, fallback = 'Objeto') {
  const name = String(value ?? '').trim();
  return name.slice(0, 64) || fallback;
}

function safeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result = {};

  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      result[key] = item;
    }
  }

  return result;
}

export class Instance {
  constructor(className, name = null, properties = {}) {
    this.id = createId();
    this.className = String(className || 'Frame');
    this.name = safeName(name, this.className);
    this.properties = {
      ...(DEFAULT_PROPERTIES[this.className] || {}),
      ...safeProperties(properties)
    };

    this.parent = null;
    this.children = [];
  }

  setParent(parent) {
    if (!(parent instanceof Instance)) {
      throw new Error('O pai precisa ser uma Instance válida.');
    }

    if (parent === this) {
      throw new Error('Um objeto não pode ser pai de si mesmo.');
    }

    let current = parent;

    while (current) {
      if (current === this) {
        throw new Error('Essa operação criaria um ciclo na hierarquia.');
      }

      current = current.parent;
    }

    if (this.parent === parent) return this;

    this.removeFromParent();

    this.parent = parent;
    parent.children.push(this);

    return this;
  }

  removeFromParent() {
    if (!this.parent) return this;

    const siblings = this.parent.children;
    const index = siblings.indexOf(this);

    if (index !== -1) {
      siblings.splice(index, 1);
    }

    this.parent = null;

    return this;
  }

  destroy() {
    this.removeFromParent();

    for (const child of [...this.children]) {
      child.destroy();
    }

    this.children = [];
    this.parent = null;
  }

  find(id) {
    if (this.id === id) return this;

    for (const child of this.children) {
      const result = child.find(id);

      if (result) return result;
    }

    return null;
  }

  getAll() {
    const result = [];

    const walk = (node) => {
      result.push(node);

      node.children.forEach(walk);
    };

    walk(this);

    return result;
  }

  toJSON() {
    return {
      id: this.id,
      className: this.className,
      name: this.name,
      properties: { ...this.properties },
      children: this.children.map((child) => child.toJSON())
    };
  }

  static fromJSON(data, seen = new Set()) {
    if (!data || typeof data !== 'object') {
      throw new Error('Objeto inválido no arquivo do projeto.');
    }

    const node = new Instance(
      data.className,
      data.name,
      data.properties
    );

    if (
      typeof data.id === 'string' &&
      data.id.length > 0 &&
      !seen.has(data.id)
    ) {
      node.id = data.id;
    }

    seen.add(node.id);

    if (Array.isArray(data.children)) {
      for (const childData of data.children) {
        const child = Instance.fromJSON(childData, seen);
        child.setParent(node);
      }
    }

    return node;
  }
}

export class DataModel {
  constructor() {
    this.root = new Instance('Root', 'Projeto');
  }

  create(className, name, parent = this.root) {
    const node = new Instance(className, name);
    node.setParent(parent);
    return node;
  }

  find(id) {
    return this.root.find(id);
  }

  getAll() {
    return this.root.getAll().filter(
      (node) => node !== this.root
    );
  }

  loadFromJSON(data) {
    if (!Array.isArray(data)) {
      throw new Error('A estrutura do projeto precisa ser uma lista.');
    }

    const root = new Instance('Root', 'Projeto');
    const seen = new Set();

    for (const item of data) {
      const node = Instance.fromJSON(item, seen);
      node.setParent(root);
    }

    this.root = root;

    return this;
  }

  toJSON() {
    return this.root.children.map((node) => node.toJSON());
  }

  clear() {
    for (const child of [...this.root.children]) {
      child.destroy();
    }

    this.root.children = [];
  }
}

export { DEFAULT_PROPERTIES };
