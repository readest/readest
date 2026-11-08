// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { syncBookToVault } from '@/services/obsidian/vaultSync';
import type { VaultHighlight } from '@/services/obsidian/vaultNote';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

const FOLDER = '/vault/Readest';
const book = { hash: 'h1', title: 'Dune', author: 'Frank Herbert' } as Book;

const highlight = (id: string, patch: Partial<VaultHighlight> = {}): VaultHighlight => ({
  id,
  text: `${id} text`,
  note: '',
  color: 'yellow',
  chapter: null,
  url: `https://example.com/${id}`,
  deleted: false,
  ...patch,
});

const memoryAppService = () => {
  const files = new Map<string, string>();
  const key = (path: string, base: string) => `${base}:${path}`;
  return {
    exists: async (path: string, base: string) => files.has(key(path, base)),
    readFile: async (path: string, base: string) => {
      const text = files.get(key(path, base));
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    writeFile: async (path: string, base: string, text: string) => {
      files.set(key(path, base), text);
    },
    readDirectory: async () => [],
    createDir: async () => {},
    copyFile: async () => {},
  } as unknown as AppService;
};

describe('syncBookToVault', () => {
  it('reports how many highlights it changed in the vault', async () => {
    const appService = memoryAppService();

    expect(
      await syncBookToVault(appService, FOLDER, book, undefined, [
        highlight('a1'),
        highlight('a2'),
      ]),
    ).toBe(2);
    expect(
      await syncBookToVault(appService, FOLDER, book, undefined, [
        highlight('a1'),
        highlight('a2'),
      ]),
    ).toBe(0);
  });

  it('reports nothing for a book with no highlights', async () => {
    expect(await syncBookToVault(memoryAppService(), FOLDER, book, undefined, [])).toBe(0);
  });
});
