import { FileHandle, open, BaseDirectory, SeekMode } from '@tauri-apps/plugin-fs';
import { getOSPlatform } from './misc';

class ChunkLRUCache {
  #maxItems: number;
  #order: number[] = [];
  #cache: Map<number, ArrayBuffer> = new Map();

  constructor(maxItems: number) {
    this.#maxItems = maxItems;
  }

  /** [start, end) exclusive-end. Returns the cached hit or undefined. */
  findChunk(start: number, end: number): { chunkStart: number; buffer: ArrayBuffer } | undefined {
    for (const chunkStart of this.#cache.keys()) {
      const buffer = this.#cache.get(chunkStart)!;
      if (start >= chunkStart && end <= chunkStart + buffer.byteLength) {
        this.#touch(chunkStart);
        return { chunkStart, buffer };
      }
    }
    return undefined;
  }

  set(chunkStart: number, buffer: ArrayBuffer): void {
    this.#cache.set(chunkStart, buffer);
    this.#touch(chunkStart);
    this.#evict();
  }

  clear(): void {
    this.#cache.clear();
    this.#order = [];
  }

  #touch(chunkStart: number): void {
    const i = this.#order.indexOf(chunkStart);
    if (i > -1) this.#order.splice(i, 1);
    this.#order.unshift(chunkStart);
  }

  #evict(): void {
    while (this.#cache.size > this.#maxItems) {
      const key = this.#order.pop();
      if (key !== undefined) this.#cache.delete(key);
    }
  }
}

async function withPendingDedup<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = fn();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}

class DeferredBlob extends Blob {
  #dataPromise: Promise<ArrayBuffer>;
  #type: string;

  constructor(dataPromise: Promise<ArrayBuffer>, type: string) {
    super();
    this.#dataPromise = dataPromise;
    this.#type = type;
  }

  override async arrayBuffer() {
    const data = await this.#dataPromise;
    return data;
  }

  override async text() {
    const data = await this.#dataPromise;
    return new TextDecoder().decode(data);
  }

  override stream() {
    return new ReadableStream({
      start: async (controller) => {
        const data = await this.#dataPromise;
        controller.enqueue(new Uint8Array(data));
        controller.close();
      },
    });
  }

  override get type() {
    return this.#type;
  }
}

export interface ClosableFile extends File {
  open(): Promise<this>;
  close(): Promise<void>;
}

export class NativeFile extends File implements ClosableFile {
  #handle: FileHandle | null = null;
  #fp: string;
  #name: string;
  #baseDir: BaseDirectory | null;
  #lastModified: number = 0;
  #size: number = -1;
  #type: string = '';

  static MAX_CACHE_CHUNK_SIZE = 1024 * 1024;
  static MAX_CACHE_ITEMS_SIZE = 50;
  #lru = new ChunkLRUCache(NativeFile.MAX_CACHE_ITEMS_SIZE);
  #pendingReads: Map<string, Promise<ArrayBuffer>> = new Map();

  constructor(fp: string, name?: string, baseDir: BaseDirectory | null = null, type = '') {
    super([], name || fp, { type });
    this.#fp = fp;
    this.#baseDir = baseDir;
    this.#name = name || fp;
  }

  async open() {
    this.#handle = await open(this.#fp, this.#baseDir ? { baseDir: this.#baseDir } : undefined);
    const stats = await this.#handle.stat();
    this.#size = stats.size;
    this.#lastModified = stats.mtime ? stats.mtime.getTime() : Date.now();
    return this;
  }

  async close() {
    if (this.#handle) {
      await this.#handle.close();
      this.#handle = null;
    }
    this.#lru.clear();
  }

  override get name() {
    return this.#name;
  }

  override get type() {
    return this.#type;
  }

  override get size() {
    return this.#size;
  }

  override get lastModified() {
    return this.#lastModified;
  }

  async stat() {
    return this.#handle?.stat();
  }

  async seek(offset: number, whence: SeekMode): Promise<number> {
    if (!this.#handle) {
      throw new Error('File handle is not open');
    }
    return this.#handle.seek(offset, whence);
  }

  // exclusive reading of the end: [start, end)
  async readData(start: number, end: number): Promise<ArrayBuffer> {
    start = Math.max(0, start);
    end = Math.max(start, Math.min(this.size, end));
    const size = end - start;

    if (size > NativeFile.MAX_CACHE_CHUNK_SIZE) {
      const handle = await open(this.#fp, this.#baseDir ? { baseDir: this.#baseDir } : undefined);
      try {
        await handle.seek(start, SeekMode.Start);
        const buffer = new Uint8Array(size);
        await handle.read(buffer);
        return buffer.buffer;
      } finally {
        await handle.close();
      }
    }

    const hit = this.#lru.findChunk(start, end);
    if (hit) {
      const offset = start - hit.chunkStart;
      return hit.buffer.slice(offset, offset + size);
    }

    return withPendingDedup(this.#pendingReads, `${start}-${end}`, () =>
      this.#readAndCacheChunkSafe(start, size),
    );
  }

  async #readAndCacheChunkSafe(start: number, size: number): Promise<ArrayBuffer> {
    const handle = await open(this.#fp, this.#baseDir ? { baseDir: this.#baseDir } : undefined);
    try {
      const chunkStart = Math.max(0, start - 1024);
      const chunkEnd = Math.min(this.size, start + NativeFile.MAX_CACHE_CHUNK_SIZE);
      const chunkSize = chunkEnd - chunkStart;

      await handle.seek(chunkStart, SeekMode.Start);
      const buffer = new Uint8Array(chunkSize);
      await handle.read(buffer);

      // Only one thread reaches here per unique range
      this.#lru.set(chunkStart, buffer.buffer);

      const offset = start - chunkStart;
      return buffer.buffer.slice(offset, offset + size);
    } finally {
      await handle.close();
    }
  }

  override slice(start = 0, end = this.size, contentType = this.type): Blob {
    // console.log(`Slicing: ${start}-${end}, size: ${end - start}`);
    const dataPromise = this.readData(start, end);
    return new DeferredBlob(dataPromise, contentType);
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const CHUNK_SIZE = 1024 * 1024;
    let offset = 0;
    let streamHandle: FileHandle | null = null;
    let streamClosed = false;

    const ensureHandle = async () => {
      if (streamHandle) return streamHandle;
      streamHandle = await open(this.#fp, this.#baseDir ? { baseDir: this.#baseDir } : undefined);
      streamClosed = false;
      return streamHandle;
    };

    const closeHandle = async () => {
      if (!streamHandle || streamClosed) return;
      await streamHandle.close();
      streamClosed = true;
      streamHandle = null;
    };

    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull: async (controller) => {
        const handle = await ensureHandle();

        if (offset >= this.size) {
          await closeHandle();
          controller.close();
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, this.size);
        const buffer = new Uint8Array(end - offset);

        await handle.seek(offset, SeekMode.Start);
        const bytesRead = await handle.read(buffer);

        if (bytesRead === null || bytesRead === 0) {
          await closeHandle();
          controller.close();
          return;
        }

        controller.enqueue(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      },

      cancel: async () => {
        await closeHandle();
      },
    });
  }

  override async text() {
    const blob = this.slice(0, this.size);
    return blob.text();
  }

  override async arrayBuffer() {
    const blob = this.slice(0, this.size);
    return blob.arrayBuffer();
  }
}

export class IDBFile extends File implements ClosableFile {
  #path: string;
  #name: string;
  #size: number = -1;
  #type: string;
  #blob: Blob | null = null;
  #getRecord: (path: string) => Promise<{ content: Blob | ArrayBuffer | string }>;
  #migrateFn: ((path: string, blob: Blob) => void) | undefined;

  constructor(
    path: string,
    getRecord: (path: string) => Promise<{ content: Blob | ArrayBuffer | string }>,
    migrateFn?: (path: string, blob: Blob) => void,
    name?: string,
    type = '',
  ) {
    super([], name || path, { type });
    this.#path = path;
    this.#name = name || path;
    this.#type = type;
    this.#getRecord = getRecord;
    this.#migrateFn = migrateFn;
  }

  async open(): Promise<this> {
    const record = await this.#getRecord(this.#path);
    const { content } = record;
    if (content instanceof Blob) {
      // Already a Blob — browser keeps bytes on disk, lazy slice is free.
      this.#blob = content;
    } else {
      // Legacy ArrayBuffer record: wrap in Blob so slice() works, then
      // fire-and-forget migration so the next open gets the lazy path.
      this.#blob = new Blob([content as ArrayBuffer | string]);
      this.#migrateFn?.(this.#path, this.#blob);
    }
    this.#size = this.#blob.size;
    return this;
  }

  async close(): Promise<void> {
    this.#blob = null;
  }

  override get name() {
    return this.#name;
  }

  override get type() {
    return this.#type;
  }

  override get size() {
    return this.#size;
  }

  override slice(start = 0, end = this.size, contentType = ''): Blob {
    if (!this.#blob) throw new Error('IDBFile not opened');
    return this.#blob.slice(start, end, contentType);
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    if (!this.#blob) throw new Error('IDBFile not opened');
    return this.#blob.arrayBuffer();
  }

  override async text(): Promise<string> {
    if (!this.#blob) throw new Error('IDBFile not opened');
    return this.#blob.text();
  }
}

export class RemoteFile extends File implements ClosableFile {
  url: string;
  #name: string;
  #lastModified: number;
  #size: number = -1;
  #type: string = '';
  #pendingFetches: Map<string, Promise<ArrayBuffer>> = new Map();

  static MAX_CACHE_CHUNK_SIZE = 1024 * 128;
  static MAX_CACHE_ITEMS_SIZE: number = 128;
  #lru = new ChunkLRUCache(RemoteFile.MAX_CACHE_ITEMS_SIZE);

  constructor(url: string, name?: string, type = '', lastModified = Date.now()) {
    const basename = url.split('/').pop() || 'remote-file';
    super([], name || basename, { type, lastModified });
    this.url = url;
    this.#name = name || basename;
    this.#type = type;
    this.#lastModified = lastModified;
  }

  override get name() {
    return this.#name;
  }

  override get type() {
    return this.#type;
  }

  override get size() {
    return this.#size;
  }

  override get lastModified() {
    return this.#lastModified;
  }

  async _open_with_head() {
    const response = await fetch(this.url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Failed to fetch file size: ${response.status}`);
    }
    this.#size = Number(response.headers.get('content-length'));
    this.#type = response.headers.get('content-type') || '';
    return this;
  }

  async _open_with_range() {
    const response = await fetch(this.url, { headers: { Range: `bytes=${0}-${1023}` } });
    if (!response.ok) {
      throw new Error(`Failed to fetch file size: ${response.status}`);
    }
    this.#size = Number(response.headers.get('content-range')?.split('/')[1]);
    this.#type = response.headers.get('content-type') || '';
    return this;
  }

  async open() {
    // FIXME: currently HEAD request in asset protocol is not supported on Android
    if (getOSPlatform() === 'android') {
      return this._open_with_range();
    } else {
      return this._open_with_head();
    }
  }

  async close(): Promise<void> {
    this.#lru.clear();
  }

  async fetchRangePart(start: number, end: number) {
    start = Math.max(0, start);
    end = Math.min(this.size - 1, end);
    // console.log(`Fetching range: ${start}-${end}, size: ${end - start + 1}`);
    const response = await fetch(this.url, { headers: { Range: `bytes=${start}-${end}` } });
    if (!response.ok) {
      throw new Error(`Failed to fetch range: ${response.status}`);
    }
    return response.arrayBuffer();
  }

  // inclusive reading of the end: [start, end]
  async fetchRange(start: number, end: number): Promise<ArrayBuffer> {
    const rangeSize = end - start + 1;
    const MAX_RANGE_LEN = 1024 * 1000;

    if (rangeSize > MAX_RANGE_LEN) {
      const buffers: ArrayBuffer[] = [];
      for (let currentStart = start; currentStart <= end; currentStart += MAX_RANGE_LEN) {
        const currentEnd = Math.min(currentStart + MAX_RANGE_LEN - 1, end);
        buffers.push(await this.fetchRangePart(currentStart, currentEnd));
      }
      const totalSize = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
      const combinedBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const buffer of buffers) {
        combinedBuffer.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }
      return combinedBuffer.buffer;
    } else if (rangeSize > RemoteFile.MAX_CACHE_CHUNK_SIZE) {
      return this.fetchRangePart(start, end);
    } else {
      // end is inclusive; findChunk uses exclusive end convention
      const hit = this.#lru.findChunk(start, end + 1);
      if (hit) {
        const offset = start - hit.chunkStart;
        return hit.buffer.slice(offset, offset + rangeSize);
      }

      return withPendingDedup(this.#pendingFetches, `${start}-${end}`, () =>
        this.#fetchAndCacheChunkSafe(start, end, rangeSize),
      );
    }
  }

  async #fetchAndCacheChunkSafe(
    start: number,
    end: number,
    rangeSize: number,
  ): Promise<ArrayBuffer> {
    const chunkStart = Math.max(0, start - 1024);
    const chunkEnd = Math.max(end, start + RemoteFile.MAX_CACHE_CHUNK_SIZE - 1024 - 1);
    const buffer = await this.fetchRangePart(chunkStart, chunkEnd);

    // Only one thread reaches here per unique range
    this.#lru.set(chunkStart, buffer);

    const offset = start - chunkStart;
    return buffer.slice(offset, offset + rangeSize);
  }

  override slice(start = 0, end = this.size, contentType = this.type): Blob {
    // console.log(`Slicing: ${start}-${end}, size: ${end - start}`);
    const dataPromise = this.fetchRange(start, end - 1);

    return new DeferredBlob(dataPromise, contentType);
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const CHUNK_SIZE = 1024 * 1024;
    let offset = 0;

    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull: async (controller) => {
        if (offset >= this.size) {
          controller.close();
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, this.size);
        const buffer = await this.fetchRange(offset, end - 1);

        controller.enqueue(new Uint8Array(buffer));
        offset = end;
      },
    });
  }

  override async text() {
    const blob = this.slice(0, this.size);
    return blob.text();
  }

  override async arrayBuffer() {
    const blob = this.slice(0, this.size);
    return blob.arrayBuffer();
  }
}
