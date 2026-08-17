import {
  Reader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';
import { MAX_PLUGIN_RESOURCE_BYTES } from '@/services/plugins/contract';
import { normalizeYomitanResourcePath } from './content';

const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 64 * 1_024 * 1_024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 1_024 * 1_024 * 1_024;

export interface YomitanArchiveHost {
  signal: AbortSignal;
  stat(handle: string): Promise<{ name: string; size: number; type?: string }>;
  readRange(
    handle: string,
    offset: number,
    length: number,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer> }>;
}

class HostSourceReader extends Reader<string> {
  constructor(
    private readonly handle: string,
    private readonly host: YomitanArchiveHost,
  ) {
    super(handle);
  }

  override async init(): Promise<void> {
    await super.init?.();
    this.size = (await this.host.stat(this.handle)).size;
  }

  override async readUint8Array(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    if (this.host.signal.aborted) throw new DOMException('Yomitan operation aborted', 'AbortError');
    return (await this.host.readRange(this.handle, offset, length)).bytes;
  }
}

const isFileEntry = (entry: Entry): entry is FileEntry => !entry.directory;

export class YomitanArchive {
  private readonly byName: Map<string, FileEntry>;

  constructor(
    private readonly reader: ZipReader<string>,
    readonly entries: FileEntry[],
  ) {
    this.byName = new Map(entries.map((entry) => [entry.filename, entry]));
  }

  has(path: string): boolean {
    return this.byName.has(path);
  }

  list(pattern?: RegExp): FileEntry[] {
    return pattern
      ? this.entries.filter((entry) => pattern.test(entry.filename))
      : [...this.entries];
  }

  private require(path: string, maxBytes: number): FileEntry {
    const safePath = normalizeYomitanResourcePath(path);
    const entry = this.byName.get(safePath);
    if (!entry) throw new Error(`Yomitan archive resource not found: ${safePath}`);
    if (entry.uncompressedSize > Math.min(maxBytes, MAX_ENTRY_BYTES)) {
      throw new Error(`Yomitan archive entry exceeds size limit: ${safePath}`);
    }
    return entry;
  }

  async readJson(path: string, maxBytes = MAX_ENTRY_BYTES): Promise<unknown> {
    const entry = this.require(path, maxBytes);
    const text = await entry.getData(new TextWriter('utf-8'), {
      checkSignature: true,
      useWebWorkers: false,
    });
    return JSON.parse(text);
  }

  async readBytes(
    path: string,
    maxBytes = MAX_PLUGIN_RESOURCE_BYTES,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const entry = this.require(path, maxBytes);
    return entry.getData(new Uint8ArrayWriter(), {
      checkSignature: true,
      useWebWorkers: false,
    });
  }

  async close(): Promise<void> {
    await this.reader.close();
  }
}

export const openYomitanArchive = async (
  host: YomitanArchiveHost,
  sourceHandle: string,
): Promise<YomitanArchive> => {
  const reader = new ZipReader(new HostSourceReader(sourceHandle, host), {
    useWebWorkers: false,
    checkSignature: true,
    signal: host.signal,
  });
  try {
    const allEntries = await reader.getEntries();
    if (allEntries.length > MAX_ARCHIVE_ENTRIES)
      throw new Error('Yomitan archive has too many entries');
    const entries = allEntries.filter(isFileEntry);
    let totalBytes = 0;
    const names = new Set<string>();
    for (const entry of entries) {
      normalizeYomitanResourcePath(entry.filename);
      if (entry.encrypted) throw new Error('Encrypted Yomitan archives are not supported');
      if (names.has(entry.filename))
        throw new Error(`Duplicate Yomitan archive entry: ${entry.filename}`);
      names.add(entry.filename);
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`Yomitan archive entry exceeds size limit: ${entry.filename}`);
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new Error('Yomitan archive exceeds the uncompressed size limit');
      }
    }
    return new YomitanArchive(reader, entries);
  } catch (error) {
    await reader.close().catch(() => undefined);
    throw error;
  }
};
