/**
 * Small in-memory LRU. Used on the client so scrubbing back and forth over the
 * timeline never refetches a commit or tree we already have.
 *
 * Deliberately in-memory only: GitHub payloads are far too large for
 * localStorage, and a stale sessionStorage copy would outlive a force-push.
 */
export class Lru<K, V> {
  #map = new Map<K, V>();
  readonly #capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError('LRU capacity must be at least 1');
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#map.size;
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  get(key: K): V | undefined {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key)!;
    // Re-insert to mark as most recently used.
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.#capacity) {
      const oldest = this.#map.keys().next();
      if (oldest.done) break;
      this.#map.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.#map.delete(key);
  }

  clear(): void {
    this.#map.clear();
  }

  keys(): K[] {
    return [...this.#map.keys()];
  }
}

/**
 * Wraps a loader so concurrent callers asking for the same key share one
 * request, and results are cached.
 */
export class DedupedCache<V> {
  readonly #cache: Lru<string, V>;
  readonly #inFlight = new Map<string, Promise<V>>();

  constructor(capacity: number) {
    this.#cache = new Lru<string, V>(capacity);
  }

  peek(key: string): V | undefined {
    return this.#cache.get(key);
  }

  has(key: string): boolean {
    return this.#cache.has(key);
  }

  set(key: string, value: V): void {
    this.#cache.set(key, value);
  }

  get inFlightCount(): number {
    return this.#inFlight.size;
  }

  async load(key: string, loader: () => Promise<V>): Promise<V> {
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;

    const existing = this.#inFlight.get(key);
    if (existing) return existing;

    const promise = loader()
      .then((value) => {
        this.#cache.set(key, value);
        return value;
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });

    this.#inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.#cache.clear();
    this.#inFlight.clear();
  }
}
