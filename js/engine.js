import { DataModel } from './datamodel.js?v=2026.11.16.48';
export const PROJECT_SCHEMA_VERSION = 2;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeArray = value => Array.isArray(value) ? value : [];
const safeText = (value, fallback = '') => String(value ?? fallback).trim().slice(0, 64);

export function createProjectRecord(input = {}) {
  const now = new Date().toISOString();
  return normalizeProject({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: input.id || createId(),
    name: input.name || 'Meu projeto',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    data: safeArray(input.data),
    components: safeArray(input.components),
    events: safeArray(input.events),
    scripts: safeArray(input.scripts),
    animations: safeArray(input.animations),
    settings: isRecord(input.settings) ? input.settings : {}
  });
}

export function normalizeProject(input = {}, overrides = {}) {
  const source = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: String(overrides.id || source.id || createId()),
    name: safeText(overrides.name ?? source.name, 'Meu projeto') || 'Meu projeto',
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
    data: safeArray(source.data),
    components: safeArray(source.components),
    events: safeArray(source.events),
    scripts: safeArray(source.scripts),
    animations: safeArray(source.animations),
    settings: isRecord(source.settings) ? { ...source.settings } : {}
  };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ||
    'flowiq_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(name, callback) {
    if (typeof callback !== 'function') throw new TypeError('O listener precisa ser uma função.');
    const key = String(name);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(callback);
    return () => this.off(key, callback);
  }

  once(name, callback) {
    let unsubscribe;
    unsubscribe = this.on(name, payload => {
      unsubscribe();
      callback(payload);
    });
    return unsubscribe;
  }

  off(name, callback) {
    const listeners = this.listeners.get(String(name));
    if (!listeners) return;
    listeners.delete(callback);
    if (!listeners.size) this.listeners.delete(String(name));
  }

  emit(name, payload) {
    const listeners = [...(this.listeners.get(String(name)) || [])];
    for (const callback of listeners) callback(payload);
    return listeners.length;
  }

  clear() {
    this.listeners.clear();
  }
}

export class ComponentRegistry {
  constructor() {
    this.types = new Map();
    this.register('Frame', { category: 'interface', container: true });
    this.register('TextButton', { category: 'interface', interactive: true });
    this.register('TextLabel', { category: 'interface' });
    this.register('ImageLabel', { category: 'media' });
  }

  register(name, definition = {}) {
    const key = String(name || '').trim();
    if (!key) throw new Error('O componente precisa ter um nome.');
    this.types.set(key, Object.freeze({ name: key, ...definition }));
    return this;
  }

  get(name) {
    return this.types.get(String(name)) || null;
  }

  has(name) {
    return this.types.has(String(name));
  }

  list() {
    return [...this.types.values()];
  }
}

const BLOCKED_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor']);

export class FlowiqRuntime {
  constructor({ model, onChange = () => {}, onLog = () => {} } = {}) {
    this.model = model;
    this.onChange = onChange;
    this.onLog = onLog;
    this.events = new EventBus();
    this.components = new ComponentRegistry();
    this.project = null;
    this.editorModel = null;
    this.running = false;
    this.maxActionsPerEvent = 64;
  }

  start(project) {
    this.stop();
    this.editorModel = this.model;
    this.project = normalizeProject(project);
    const runtimeModel = new DataModel();
    runtimeModel.loadFromJSON(this.project.data);
    this.model = runtimeModel;
    this.running = true;
    this.events.emit('runtime:start', { project: this.project });
    return this;
  }

  stop() {
    if (this.running) this.events.emit('runtime:stop', { project: this.project });
    this.running = false;
    this.project = null;
    if (this.editorModel) {
      this.model = this.editorModel;
      this.editorModel = null;
    }
    return this;
  }

  dispatch(node, eventName, payload = {}) {
    if (!this.running || !node) return 0;
    const name = String(eventName || '').toLowerCase();
    const matching = this.project.events.filter(event =>
      event && String(event.event || event.trigger || '').toLowerCase() === name &&
      (event.nodeId === node.id || event.nodeId === '*')
    );
    let executed = 0;
    for (const event of matching) {
      const actions = safeArray(event.actions).slice(0, this.maxActionsPerEvent);
      for (const action of actions) {
        if (this.executeAction(action, node, payload)) executed++;
      }
    }
    this.events.emit('runtime:event', { node, event: name, payload, executed });
    return executed;
  }

  executeAction(action, sourceNode, payload) {
    if (!isRecord(action)) return false;
    const target = action.targetId ? this.model?.find(action.targetId) : sourceNode;
    switch (action.type) {
      case 'setProperty': {
        if (!target) return false;
        const property = String(action.property || '');
        if (!property || BLOCKED_PROPERTIES.has(property)) return false;
        const value = action.value;
        if (!['string', 'number', 'boolean'].includes(typeof value)) return false;
        target.properties[property] = value;
        this.onChange({ type: 'property', node: target, property, value });
        return true;
      }
      case 'setText': {
        if (!target) return false;
        target.properties.text = String(action.value ?? '').slice(0, 2000);
        this.onChange({ type: 'property', node: target, property: 'text', value: target.properties.text });
        return true;
      }
      case 'toggleVisibility': {
        if (!target) return false;
        target.properties.visible = target.properties.visible === false;
        this.onChange({ type: 'property', node: target, property: 'visible', value: target.properties.visible });
        return true;
      }
      case 'log':
        this.onLog(String(action.message || 'Evento executado').slice(0, 500));
        return true;
      default:
        return false;
    }
  }
}
