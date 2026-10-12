import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

// `@/libs/document` loads the vendored pdf.js build (absent in a bare checkout).
vi.mock('@/libs/document', () => ({}));

import { loadBookConfig } from '@/services/bookService';
import { getConfigFilename } from '@/utils/book';

// loadBookConfig used to catch EVERY error — including a JSON parse error on an
// existing-but-corrupt config file — and return empty defaults. The ~1.5s
// autosave would then rewrite config.json from those defaults, permanently
// wiping the user's highlights, bookmarks and reading position. The fix
// distinguishes "file missing" (defaults are correct) from "file exists but
// unparseable" (back the raw bytes up to a `.bak` before returning defaults so
// the data survives the overwrite).

const makeBook = (): Book =>
  ({ hash: 'deadbeef', format: 'EPUB', title: 't', author: 'a' }) as unknown as Book;

const settings = { globalViewSettings: {} } as unknown as SystemSettings;

const makeFs = (opts: { exists: boolean; content?: string; throwOnRead?: boolean }) => {
  const writes: Array<{ path: string; content: unknown }> = [];
  const fs = {
    exists: vi.fn(async (path: string) => {
      if (path.endsWith('.bak')) return false; // no prior backup
      return opts.exists;
    }),
    readFile: vi.fn(async () => {
      if (opts.throwOnRead) throw new Error('read failed');
      return opts.content ?? '';
    }),
    writeFile: vi.fn(async (path: string, _base: string, content: unknown) => {
      writes.push({ path, content });
    }),
  } as unknown as FileSystem;
  return { fs, writes };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadBookConfig — corrupt config protection', () => {
  const book = makeBook();
  const configName = getConfigFilename(book);

  it('backs up a corrupt (unparseable) existing config before returning defaults', async () => {
    const corrupt = '{ this is not valid json ';
    const { fs, writes } = makeFs({ exists: true, content: corrupt });

    const config = await loadBookConfig(fs, book, settings);

    // Defaults are returned so the reader still opens...
    expect(config.booknotes ?? []).toEqual([]);
    // ...but the raw corrupt bytes are preserved in a .bak so autosave's
    // overwrite of config.json does not destroy them.
    const backup = writes.find((w) => w.path === `${configName}.bak`);
    expect(backup).toBeDefined();
    expect(backup!.content).toBe(corrupt);
  });

  it('does not write a backup when the config is simply missing', async () => {
    const { fs, writes } = makeFs({ exists: false });

    const config = await loadBookConfig(fs, book, settings);

    expect(config.booknotes ?? []).toEqual([]);
    expect(writes.find((w) => w.path.endsWith('.bak'))).toBeUndefined();
  });

  it('returns the parsed config untouched when it is valid', async () => {
    const valid = JSON.stringify({ bookHash: 'deadbeef', booknotes: [{ id: 'n1', cfi: 'x' }] });
    const { fs, writes } = makeFs({ exists: true, content: valid });

    const config = await loadBookConfig(fs, book, settings);

    expect(config.booknotes).toHaveLength(1);
    expect(writes.find((w) => w.path.endsWith('.bak'))).toBeUndefined();
  });
});
