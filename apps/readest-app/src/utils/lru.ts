export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, V>;
  private onEvict?: (key: K, value: V) => void;

  constructor(capacity: number, onEvict?: (key: K, value: V) => void) {
    if (capacity <= 0) {
      throw new Error('LRUCache capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.map = new Map();
    this.onEvict = onEvict;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      const oldValue = this.map.get(key)!;
      this.map.delete(key);
      if (this.onEvict) {
        this.onEvict(key, oldValue);
      }
    } else if (this.map.size === this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey) {
        const oldestValue = this.map.get(oldestKey)!;
        this.map.delete(oldestKey);
        if (this.onEvict) {
          this.onEvict(oldestKey, oldestValue);
        }
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    if (this.map.has(key)) {
      const value = this.map.get(key)!;
      const deleted = this.map.delete(key);
      if (deleted && this.onEvict) {
        this.onEvict(key, value);
      }
      return deleted;
    }
    return false;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.map) {
        this.onEvict(key, value);
      }
    }
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  entries(): Array<[K, V]> {
    return Array.from(this.map).reverse();
  }
}
