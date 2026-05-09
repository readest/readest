/**
 * Byte-counting FileSystem wrapper for dictionary-provider perf tests.
 *
 * Wraps a real `DictionaryFileOpener` so every byte that flows out of a
 * `File.slice(...).arrayBuffer()` (or a direct `File.arrayBuffer()`) gets
 * tallied. Used to catch perf regressions like "lookup accidentally
 * re-reads the whole dict file" or "init reads way more than necessary".
 *
 * Tracks reads per-file so individual assertions can target a specific
 * bundle file (e.g. the .dict.dz vs the .idx).
 */
import type { BaseDir } from '@/types/system';
import type { DictionaryFileOpener } from '@/services/dictionaries/providers/starDictProvider';

export interface ReadCounter {
  /** Total bytes read across all files. */
  total: number;
  /** Per-file (basename) byte tallies. */
  perFile: Map<string, number>;
}

export const makeReadCounter = (): ReadCounter => ({ total: 0, perFile: new Map() });

const bump = (counter: ReadCounter, name: string, n: number) => {
  counter.total += n;
  counter.perFile.set(name, (counter.perFile.get(name) ?? 0) + n);
};

class CountingBlob extends Blob {
  constructor(
    private inner: Blob,
    private counter: ReadCounter,
    private name: string,
  ) {
    super();
  }

  override get size() {
    return this.inner.size;
  }

  override get type() {
    return this.inner.type;
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    return new CountingBlob(this.inner.slice(start, end, contentType), this.counter, this.name);
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    const buf = await this.inner.arrayBuffer();
    bump(this.counter, this.name, buf.byteLength);
    return buf;
  }

  override async text(): Promise<string> {
    const t = await this.inner.text();
    bump(this.counter, this.name, new TextEncoder().encode(t).byteLength);
    return t;
  }
  // `stream()` deliberately not overridden — none of the dictionary code
  // paths call it, and the inner Blob's `stream()` type isn't assignable to
  // Blob's stricter overload signature in current lib.dom typings.
}

class CountingFile extends File {
  constructor(
    private inner: Blob,
    name: string,
    private counter: ReadCounter,
  ) {
    super([], name);
  }

  override get size() {
    return this.inner.size;
  }

  override get type() {
    return this.inner.type;
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    return new CountingBlob(this.inner.slice(start, end, contentType), this.counter, this.name);
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    const buf = await this.inner.arrayBuffer();
    bump(this.counter, this.name, buf.byteLength);
    return buf;
  }

  override async text(): Promise<string> {
    const t = await this.inner.text();
    bump(this.counter, this.name, new TextEncoder().encode(t).byteLength);
    return t;
  }
  // `stream()` deliberately not overridden — see CountingBlob.
}

/** Wrap a `DictionaryFileOpener` so all reads go through `counter`. */
export function withReadCounting(
  inner: DictionaryFileOpener,
  counter: ReadCounter,
): DictionaryFileOpener {
  return {
    openFile: async (path: string, base: BaseDir) => {
      const file = await inner.openFile(path, base);
      const basename = path.split('/').pop()!;
      return new CountingFile(file, basename, counter);
    },
  };
}
