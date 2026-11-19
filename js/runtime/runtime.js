import { parseFlowScript } from './flow-script.js';

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
    let count = 0;
    const scripts = Array.isArray(this.project?.scripts) ? this.project.scripts : [];
    for (const script of scripts.filter(item => item && item.nodeId === node.id && typeof item.source === 'string')) {
      try {
        const program = parseFlowScript(script.source);
        if (eventName !== program.event) continue;
        for (const command of program.commands) {
          if (command.type === 'print') { this.onLog(command.value, 'info'); continue; }
          const matches = command.target === 'self'
            ? [node]
            : [...this.scene.nodes.values()].filter(item => item.name.toLocaleLowerCase('pt-BR') === command.target.toLocaleLowerCase('pt-BR'));
          if (matches.length !== 1) {
            this.onLog(matches.length ? 'FlowScript: nome duplicado "' + command.target + '".' : 'FlowScript: objeto "' + command.target + '" não encontrado.', 'error');
            continue;
          }
          const target = matches[0];
          if (command.type === 'show') target.props.visible = true;
          else if (command.type === 'hide') target.props.visible = false;
          else if (command.type === 'setVisible') target.props.visible = command.value;
          else if (command.type === 'setText') target.props.text = command.value;
          else if (command.type === 'setProperty') {
            if (command.property === 'position' || command.property === 'size') {
              this.onLog('FlowScript: position e size devem ser editados pelo Inspector nesta versão.', 'error');
              continue;
            }
            target.props[command.property] = command.value;
          }
          count++;
        }
      } catch (error) {
        this.onLog('FlowScript: ' + (error.message || 'erro no script.'), 'error');
      }
    }
    const rules = Array.isArray(this.project?.events) ? this.project.events : [];
    const matches = rules.filter(rule => rule && rule.nodeId === node.id && String(rule.event || 'click') === eventName);
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
