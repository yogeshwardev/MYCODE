export class EventEmitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push({ listener, once: false });
    return this;
  }

  once(event, listener) {
    this.on(event, listener);
    this.#listeners.get(event).at(-1).once = true;
    return this;
  }

  off(event, listener) {
    const list = this.#listeners.get(event);
    if (list) this.#listeners.set(event, list.filter((l) => l.listener !== listener));
    return this;
  }

  emit(event, ...args) {
    const list = this.#listeners.get(event);
    if (!list?.length) return false;
    this.#listeners.set(event, list.filter((l) => !l.once));
    for (const l of list) l.listener(...args);
    return true;
  }
}
