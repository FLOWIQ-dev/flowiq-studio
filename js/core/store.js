export class Store {
  #state;
  #listeners = new Set();
  #version = 0;

  constructor(initialState) {
    this.#state = Object.freeze({ ...initialState });
  }

  get state() { return this.#state; }
  get version() { return this.#version; }

  set(patch) {
    const next = typeof patch === 'function' ? patch(this.#state) : { ...this.#state, ...patch };
    if (!next || typeof next !== 'object') throw new TypeError('Estado inválido.');
    this.#state = Object.freeze({ ...next });
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener(this.#state, this.#version);
    return this.#state;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Listener inválido.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy() { this.#listeners.clear(); }
}
