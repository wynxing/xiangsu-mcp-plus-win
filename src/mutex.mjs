// Per-key async queue. Lifecycle calls for one editor window share a key.
export class KeyedMutex {
  constructor() {
    this.tail = new Map();
  }

  run(key, fn) {
    const prev = this.tail.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.tail.set(
      key,
      run.then(
        () => {},
        () => {},
      ),
    );
    return run;
  }
}
