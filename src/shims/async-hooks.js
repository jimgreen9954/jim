export class AsyncLocalStorage {
  constructor() {
    this.store = undefined;
  }
  run(store, fn, ...args) {
    const previous = this.store;
    this.store = store;
    try {
      return fn(...args);
    } finally {
      this.store = previous;
    }
  }
  getStore() {
    return this.store;
  }
  enterWith(store) {
    this.store = store;
  }
  disable() {
    this.store = undefined;
  }
  exit(fn, ...args) {
    const previous = this.store;
    this.store = undefined;
    try {
      return fn(...args);
    } finally {
      this.store = previous;
    }
  }
}

export default { AsyncLocalStorage };
