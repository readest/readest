import { FileHandle, open, BaseDirectory, SeekMode } from '@tauri-apps/plugin-fs';
import { getOSPlatform } from './misc';

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
        const reader = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(data));
            controller.close();
          },
        }).getReader();
        const pump = () =>
          reader.read().then(({ done, value }): Promise<void> => {
            if (done) {
              controller.close();
              return Promise.resolve();
            }
            controller.enqueue(value);
            return pump();
          });
        return pump();
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
  #order: number[] = [];
  #cache: Map<number, ArrayBuffer> = new Map();
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
    this.#cache.clear();
    this.#order = [];
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

    const cachedChunkStart = Array.from(this.#cache.keys()).find((chunkStart) => {
      const buffer = this.#cache.get(chunkStart)!;
      return start >= chunkStart && end <= chunkStart + buffer.byteLength;
    });

    if (cachedChunkStart !== undefined) {
      this.#updateAccessOrder(cachedChunkStart);
      const buffer = this.#cache.get(cachedChunkStart)!;
      const offset = start - cachedChunkStart;
      return buffer.slice(offset, offset + size);
    }

    const readKey = `${start}-${end}`;
    const pendingRead = this.#pendingReads.get(readKey);

    if (pendingRead) {
      return pendingRead;
    }

    const readPromise = this.#readAndCacheChunkSafe(start, size);
    this.#pendingReads.set(readKey, readPromise);

    try {
      return await readPromise;
    } finally {
      this.#pendingReads.delete(readKey);
    }
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
      this.#cache.set(chunkStart, buffer.buffer);
      this.#updateAccessOrder(chunkStart);
      this.#ensureCacheSize();

      const offset = start - chunkStart;
      return buffer.buffer.slice(offset, offset + size);
    } finally {
      await handle.close();
    }
  }

  #updateAccessOrder(chunkStart: number) {
    const index = this.#order.indexOf(chunkStart);
    if (index > -1) {
      this.#order.splice(index, 1);
    }
    this.#order.unshift(chunkStart);
  }

  #ensureCacheSize() {
    while (this.#cache.size > NativeFile.MAX_CACHE_ITEMS_SIZE) {
      const oldestKey = this.#order.pop();
      if (oldestKey !== undefined) {
        this.#cache.delete(oldestKey);
      }
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

    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull: async (controller) => {
        if (!this.#handle) {
          controller.error(new Error('File handle is not open'));
          return;
        }

        if (offset >= this.size) {
          controller.close();
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, this.size);
        const buffer = new Uint8Array(end - offset);

        await this.#handle.seek(offset, SeekMode.Start);
        const bytesRead = await this.#handle.read(buffer);

        if (bytesRead === null || bytesRead === 0) {
          controller.close();
          return;
        }

        controller.enqueue(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      },

      cancel: async () => {
        await this.#handle?.close();
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

export class RemoteFile extends File implements ClosableFile {
  url: string;
  #name: string;
  #lastModified: number;
  #size: number = -1;
  #type: string = '';
  #order: number[] = [];
  #cache: Map<number, ArrayBuffer> = new Map(); // LRU cache
  #pendingFetches: Map<string, Promise<ArrayBuffer>> = new Map();

  static MAX_CACHE_CHUNK_SIZE = 1024 * 128;
  static MAX_CACHE_ITEMS_SIZE: number = 128;

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
    this.#cache.clear();
    this.#order = [];
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
      const cachedChunkStart = Array.from(this.#cache.keys()).find((chunkStart) => {
        const buffer = this.#cache.get(chunkStart)!;
        const bufferSize = buffer.byteLength;
        return start >= chunkStart && end <= chunkStart + bufferSize;
      });
      if (cachedChunkStart !== undefined) {
        this.#updateAccessOrder(cachedChunkStart);
        const buffer = this.#cache.get(cachedChunkStart)!;
        const offset = start - cachedChunkStart;
        return buffer.slice(offset, offset + rangeSize);
      }

      const fetchKey = `${start}-${end}`;
      const pendingFetch = this.#pendingFetches.get(fetchKey);

      if (pendingFetch) {
        return pendingFetch;
      }

      const fetchPromise = this.#fetchAndCacheChunkSafe(start, end, rangeSize);
      this.#pendingFetches.set(fetchKey, fetchPromise);
      try {
        return await fetchPromise;
      } finally {
        this.#pendingFetches.delete(fetchKey);
      }
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
    this.#cache.set(chunkStart, buffer);
    this.#updateAccessOrder(chunkStart);
    this.#ensureCacheSize();

    const offset = start - chunkStart;
    return buffer.slice(offset, offset + rangeSize);
  }

  #updateAccessOrder(chunkStart: number) {
    const index = this.#order.indexOf(chunkStart);
    if (index > -1) {
      this.#order.splice(index, 1);
    }
    this.#order.unshift(chunkStart);
  }

  #ensureCacheSize() {
    while (this.#cache.size > RemoteFile.MAX_CACHE_ITEMS_SIZE) {
      const oldestKey = this.#order.pop();
      if (oldestKey !== undefined) {
        this.#cache.delete(oldestKey);
      }
    }
  }

  override slice(start = 0, end = this.size, contentType = this.type): Blob {
    // console.log(`Slicing: ${start}-${end}, size: ${end - start}`);
    const dataPromise = this.fetchRange(start, end - 1);

    return new DeferredBlob(dataPromise, contentType);
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
