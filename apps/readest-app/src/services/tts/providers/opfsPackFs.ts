// OPFS-backed pack file IO for the web: the same TTSPackFs contract the
// native plugin-fs backend implements, so section-pack compaction works in
// the browser too. Returns undefined where OPFS is unavailable (older
// browsers, non-secure contexts); the store then keeps loose rows only.
//
// OPFS has no rename, so rename() is copy + delete. That still preserves the
// compactor's crash-safety: a partially copied final file is only adopted by
// the database in the transaction AFTER rename resolves, and unknown files
// are collected by the startup sweep.

import type { TTSPackFs } from './sqliteCacheStore';

export const createOpfsPackFs = async (dir: string): Promise<TTSPackFs | undefined> => {
  try {
    if (!navigator.storage?.getDirectory) return undefined;
    const root = await navigator.storage.getDirectory();
    let handle = root;
    for (const segment of dir.split('/').filter(Boolean)) {
      handle = await handle.getDirectoryHandle(segment, { create: true });
    }
    const packsDir = handle;

    const readBytes = async (name: string): Promise<File> => {
      const fileHandle = await packsDir.getFileHandle(name);
      return fileHandle.getFile();
    };

    return {
      async write(name, data) {
        const fileHandle = await packsDir.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        try {
          // Copy out of the view: the lib typings require a plain ArrayBuffer.
          await writable.write(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
          );
        } finally {
          await writable.close();
        }
      },
      async rename(from, to) {
        const source = await readBytes(from);
        const target = await packsDir.getFileHandle(to, { create: true });
        const writable = await target.createWritable();
        try {
          await writable.write(await source.arrayBuffer());
        } finally {
          await writable.close();
        }
        await packsDir.removeEntry(from);
      },
      async readRange(name, offset, length) {
        const file = await readBytes(name);
        const slice = await file.slice(offset, offset + length).arrayBuffer();
        if (slice.byteLength !== length) {
          throw new Error(`short pack read: ${slice.byteLength}/${length}`);
        }
        return slice;
      },
      async remove(name) {
        await packsDir.removeEntry(name);
      },
      async list() {
        // The async-iteration members are missing from the DOM lib typings.
        const iterable = packsDir as unknown as {
          entries(): AsyncIterableIterator<[string, { kind: string }]>;
        };
        const names: string[] = [];
        for await (const [name, entry] of iterable.entries()) {
          if (entry.kind === 'file') names.push(name);
        }
        return names;
      },
    };
  } catch (err) {
    console.warn('OPFS pack storage unavailable', err);
    return undefined;
  }
};
