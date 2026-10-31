import type { FileEntry, FileSyncProvider } from '@/services/sync/file/provider';

// In-memory provider: path -> bytes/text, with an operation log so tests can
// assert ordering (a pack's mp3 must land before its sidecar).
export class FakeFileSyncProvider implements FileSyncProvider {
  rootPath = '/';
  files = new Map<string, ArrayBuffer | string>();
  ops: string[] = [];
  listError: Error | null = null;

  async readText(path: string): Promise<string | null> {
    const value = this.files.get(path);
    return typeof value === 'string' ? value : null;
  }
  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const value = this.files.get(path);
    if (value === undefined) return null;
    return typeof value === 'string'
      ? (new TextEncoder().encode(value).buffer as ArrayBuffer)
      : value;
  }
  async head() {
    return null;
  }
  async list(path: string): Promise<FileEntry[]> {
    if (this.listError) throw this.listError;
    const prefix = `${path}/`;
    const out: FileEntry[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
        out.push({ name: key.slice(prefix.length), path: key, isDirectory: false });
      }
    }
    if (!out.length) throw new Error('404: no such directory');
    return out;
  }
  async writeText(path: string, body: string): Promise<void> {
    this.ops.push(`writeText:${path}`);
    this.files.set(path, body);
  }
  async writeBinary(path: string, body: ArrayBuffer): Promise<void> {
    this.ops.push(`writeBinary:${path}`);
    this.files.set(path, body);
  }
  async ensureDir(paths: string[]): Promise<void> {
    this.ops.push(`ensureDir:${paths.join(',')}`);
  }
  async deleteDir(): Promise<void> {}
}
