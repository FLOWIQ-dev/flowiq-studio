export class History {
  constructor({ limit = 80, onChange = () => {} } = {}) {
    this.limit = limit;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  checkpoint(snapshot) {
    this.undoStack.push(structuredClone(snapshot));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange(this.status);
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(structuredClone(current));
    const value = this.undoStack.pop();
    this.onChange(this.status);
    return structuredClone(value);
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(structuredClone(current));
    const value = this.redoStack.pop();
    this.onChange(this.status);
    return structuredClone(value);
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange(this.status);
  }

  get status() {
    return { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }
}
