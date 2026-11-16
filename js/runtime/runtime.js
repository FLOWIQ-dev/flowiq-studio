export class Runtime {
  constructor({ onLog = () => {} } = {}) {
    this.onLog = onLog;
    this.project = null;
    this.scene = null;
    this.running = false;
    this.actionLimit = 48;
  }

  start(project, scene) {
    this.project = JSON.parse(JSON.stringify(project));
    this.scene = scene;
    this.running = true;
    this.onLog('Pré-visualização iniciada.', 'success');
  }

  stop() {
    this.running = false;
    this.project = null;
    this.scene = null;
    this.onLog('Pré-visualização encerrada.', 'info');
  }

  dispatch(node, eventName) {
    if (!this.running || !node) return;
    const rules = Array.isArray(this.project?.events) ? this.project.events : [];
    const matches = rules.filter(rule => rule && rule.nodeId === node.id && String(rule.event || 'click') === eventName);
    let count = 0;
    for (const rule of matches) {
      for (const action of (Array.isArray(rule.actions) ? rule.actions : []).slice(0, this.actionLimit)) {
        if (action.type === 'toggleVisibility') {
          const target = this.scene.get(action.targetId || node.id);
          if (target) { target.props.visible = target.props.visible === false; count++; }
        }
        if (action.type === 'log' && typeof action.value === 'string') { this.onLog(action.value.slice(0, 300), 'info'); count++; }
        if (action.type === 'setText' && typeof action.value === 'string') {
          const target = this.scene.get(action.targetId || node.id);
          if (target) { target.props.text = action.value.slice(0, 2000); count++; }
        }
        if (action.type === 'setProperty' && typeof action.property === 'string' && !['__proto__', 'constructor', 'prototype'].includes(action.property)) {
          const target = this.scene.get(action.targetId || node.id);
          if (target && ['string', 'number', 'boolean'].includes(typeof action.value) && ['background','color','opacity','visible','radius','rotation','fontSize','text','textAlign','fontWeight'].includes(action.property)) { target.props[action.property] = action.value; count++; }
        }
      }
    }
    this.onLog('Evento ' + eventName + ': ' + count + ' ação(ões).', 'info');
  }
}
