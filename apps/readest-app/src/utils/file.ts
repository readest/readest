import { getOSPlatform } from './misc';

class RemoteBlobSlice extends Blob {
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

export class RemoteFile extends File {
  url: string;
  #name: string;
  #lastModified: number;
  #size: number = -1;
  #type: string = '';
  #cache: Map<number, ArrayBuffer> = new Map(); // LRU cache
  #order: number[] = [];

  static MAX_CACHE_CHUNK_SIZE = 1024 * 128;
  static MAX_CACHE_ITEMS_SIZE: number = 10;

  constructor(url: string, name = 'remote-file', type = '', lastModified = Date.now()) {
    super([], name, { type: type, lastModified });
    this.url = url;
    this.#name = name;
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
      let cachedChunkStart = Array.from(this.#cache.keys()).find((chunkStart) => {
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
      cachedChunkStart = await this.#fetchAndCacheChunk(start, end);
      const buffer = this.#cache.get(cachedChunkStart)!;
      const offset = start - cachedChunkStart;
      return buffer.slice(offset, offset + rangeSize);
    }
  }

  async #fetchAndCacheChunk(start: number, end: number): Promise<number> {
    const chunkStart = Math.max(0, start - 1024);
    const chunkEnd = Math.max(end, start + RemoteFile.MAX_CACHE_CHUNK_SIZE - 1024 - 1);
    this.#cache.set(chunkStart, await this.fetchRangePart(chunkStart, chunkEnd));
    this.#updateAccessOrder(chunkStart);
    this.#ensureCacheSize();
    return chunkStart;
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

    return new RemoteBlobSlice(dataPromise, contentType);
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
