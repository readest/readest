// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * #7793: custom fonts sync through the file-based providers. A font pass keeps
 * `Readest/fonts.json` and `Readest/fonts/<contentId>/<file>` in step with this
 * device's fonts; fonts from other devices are listed here and download only
 * when the user picks them.
 */

vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaDelete: vi.fn(),
  publishReplicaUpsert: vi.fn(),
}));
vi.mock('@/services/sync/replicaBinaryUpload', () => ({
  queueReplicaBinaryUpload: vi.fn(),
  queueReplicaBinaryDelete: vi.fn(),
}));

import type { EnvConfigType } from '@/services/environment';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { downloadFont, syncFonts, type RemoteFontIndex } from '@/services/sync/file/fonts';
import { useCustomFontStore } from '@/store/customFontStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { CustomFont } from '@/styles/fonts';
import type { SystemSettings } from '@/types/settings';

const INDEX = '/Readest/fonts.json';
const BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

const memoryProvider = () => {
  const files = new Map<string, string | ArrayBuffer>();
  const writes: string[] = [];
  const provider: FileSyncProvider = {
    rootPath: '/',
    readText: async (p) => {
      const v = files.get(p);
      return typeof v === 'string' ? v : null;
    },
    readBinary: async (p) => {
      const v = files.get(p);
      return v instanceof ArrayBuffer ? v : null;
    },
    head: async (p) => (files.has(p) ? {} : null),
    list: async () => [],
    writeText: async (p, body) => {
      writes.push(p);
      files.set(p, body);
    },
    writeBinary: async (p, body) => {
      writes.push(p);
      files.set(p, body);
    },
    ensureDir: async () => {},
    deleteDir: async (dir) => {
      for (const key of [...files.keys()]) if (key.startsWith(`${dir}/`)) files.delete(key);
    },
  };
  const index = () => JSON.parse(files.get(INDEX) as string) as RemoteFontIndex;
  const setIndex = (fonts: RemoteFontIndex['fonts']) =>
    files.set(INDEX, JSON.stringify({ schemaVersion: 1, fonts, updatedAt: 1 }));
  return { provider, files, writes, index, setIndex };
};

const appService = {
  readFile: vi.fn(async () => BYTES),
  writeFile: vi.fn(async () => {}),
  createDir: vi.fn(async () => {}),
  openFile: vi.fn(async (path: string) => new File([BYTES], path)),
};
const envConfig = { getAppService: async () => appService } as unknown as EnvConfigType;

const font = (overrides: Partial<CustomFont> = {}): CustomFont => ({
  id: 'f1',
  name: 'Inter Regular',
  family: 'Inter',
  style: 'normal',
  weight: 400,
  contentId: 'c1',
  bundleDir: 'b1',
  path: 'b1/Inter-Regular.ttf',
  byteSize: 4,
  downloadedAt: 100,
  ...overrides,
});

const remote = (overrides: Partial<RemoteFontIndex['fonts'][number]> = {}) => ({
  contentId: 'c1',
  filename: 'Inter-Regular.ttf',
  name: 'Inter Regular',
  family: 'Inter',
  style: 'normal',
  weight: 400,
  byteSize: 4,
  addedAt: 100,
  ...overrides,
});

// The pass hydrates the store from settings, like the Readest Cloud pull does.
const seed = (fonts: CustomFont[]) => {
  useSettingsStore.setState({ settings: { customFonts: fonts } as unknown as SystemSettings });
  useCustomFontStore.setState({ fonts: [] });
};
const fontsHere = () => useCustomFontStore.getState().fonts;

beforeEach(() => {
  vi.clearAllMocks();
  seed([]);
});

describe('syncFonts', () => {
  test('uploads a font imported here and lists it in fonts.json', async () => {
    const r = memoryProvider();
    seed([font()]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.files.get('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(BYTES);
    expect(r.index().fonts).toEqual([remote()]);
  });

  test('lists a font imported on another device without downloading it', async () => {
    const r = memoryProvider();
    r.setIndex([remote({ contentId: 'c2', filename: 'Inter-Bold.ttf', name: 'Inter Bold' })]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(fontsHere()).toHaveLength(1);
    const placeholder = fontsHere()[0]!;
    expect(placeholder).toMatchObject({
      contentId: 'c2',
      name: 'Inter Bold',
      family: 'Inter',
      unavailable: true,
      downloadedAt: 100,
    });
    expect(placeholder.path).toBe(`${placeholder.bundleDir}/Inter-Bold.ttf`);
    expect(appService.writeFile).not.toHaveBeenCalled();
  });

  test('does not duplicate a font this device already has from Readest Cloud', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    seed([font({ id: 'b1', unavailable: true })]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(fontsHere()).toHaveLength(1);
    expect(r.writes).toEqual([]);
  });

  test('leaves fonts.json alone when nothing changed', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    seed([font()]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.writes).toEqual([]);
  });

  test('a delete here removes the font file from the remote and records it', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    seed([font({ deletedAt: 200 })]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.files.has('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(false);
    expect(r.index().fonts).toEqual([remote({ deletedAt: 200 })]);
  });

  test('a delete here keeps the file a peer re-imported while this pass ran', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    seed([font({ deletedAt: 200 })]);
    const readText = r.provider.readText;
    r.provider.readText = async (p) => {
      const body = await readText(p);
      // The peer's import at 300 lands right after this pass reads fonts.json.
      r.setIndex([remote({ addedAt: 300 })]);
      return body;
    };

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.index().fonts).toEqual([remote({ addedAt: 300 })]);
    expect(r.files.get('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(BYTES);
  });

  test('a delete whose file removal fails is tried again next pass', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    seed([font({ deletedAt: 200 })]);
    const deleteDir = r.provider.deleteDir;
    r.provider.deleteDir = async () => {
      throw new Error('offline');
    };

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.index().fonts).toEqual([remote()]);

    r.provider.deleteDir = deleteDir;
    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.files.has('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(false);
    expect(r.index().fonts).toEqual([remote({ deletedAt: 200 })]);
  });

  test('a newer delete on another device removes the font here', async () => {
    const r = memoryProvider();
    r.setIndex([remote({ deletedAt: 200 })]);
    seed([font()]);

    await syncFonts(envConfig, r.provider, 'silent');

    // The peer's delete time, not this pass's: a re-import after it must win.
    expect(fontsHere()[0]?.deletedAt).toBe(200);
    expect(r.writes).toEqual([]);
  });

  test('a re-import here uploads again after an older delete elsewhere raced it', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    seed([font({ downloadedAt: 300 })]);
    const readText = r.provider.readText;
    let peerDeleted = false;
    r.provider.readText = async (p) => {
      const body = await readText(p);
      if (!peerDeleted) {
        // Both passes read the old index; the peer's delete at 200 lands first.
        peerDeleted = true;
        r.files.delete('/Readest/fonts/c1/Inter-Regular.ttf');
        r.setIndex([remote({ deletedAt: 200 })]);
      }
      return body;
    };

    await syncFonts(envConfig, r.provider, 'silent');
    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.files.get('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(BYTES);
    expect(r.index().fonts).toEqual([remote({ addedAt: 300 })]);
  });

  test('a delete lost to a racing write is listed again, then the re-import uploads', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    const deleter = [font({ deletedAt: 200 })];
    const importer = [
      font({ downloadedAt: 300 }),
      font({ id: 'f2', contentId: 'c2', bundleDir: 'b2', path: 'b2/Inter-Bold.ttf' }),
    ];
    seed(importer);
    const readText = r.provider.readText;
    let reads = 0;
    r.provider.readText = async (p) => {
      const body = await readText(p);
      if (++reads === 2) {
        // The peer's delete at 200 commits after this pass re-reads fonts.json.
        r.files.delete('/Readest/fonts/c1/Inter-Regular.ttf');
        r.setIndex([remote({ deletedAt: 200 })]);
      }
      return body;
    };

    // The importer uploads c2, and its write lists c1 over the peer's tombstone.
    await syncFonts(envConfig, r.provider, 'silent');
    r.provider.readText = readText;
    expect(r.index().fonts.map((f) => [f.contentId, f.deletedAt])).toEqual([
      ['c1', undefined],
      ['c2', undefined],
    ]);
    expect(r.files.has('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(false);

    // The deleter's next pass still sees its delete as the later event.
    seed(deleter);
    await syncFonts(envConfig, r.provider, 'silent');
    expect(r.index().fonts.find((f) => f.contentId === 'c1')?.deletedAt).toBe(200);

    // The importer's next pass sees a delete older than its import.
    seed(importer);
    await syncFonts(envConfig, r.provider, 'silent');
    expect(r.files.get('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(BYTES);
    expect(r.index().fonts.find((f) => f.contentId === 'c1')).toEqual(remote({ addedAt: 300 }));
  });

  test('keeps a delete a peer commits while this pass runs', async () => {
    const r = memoryProvider();
    r.setIndex([remote()]);
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);
    seed([font(), font({ id: 'f2', contentId: 'c2', bundleDir: 'b2', path: 'b2/Inter-Bold.ttf' })]);
    const writeBinary = r.provider.writeBinary;
    r.provider.writeBinary = async (p, body, type) => {
      await writeBinary(p, body, type);
      r.setIndex([remote({ deletedAt: 200 })]);
    };

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.index().fonts.map((f) => [f.contentId, f.deletedAt])).toEqual([
      ['c1', 200],
      ['c2', undefined],
    ]);
  });

  test('skips a listed font whose file name leaves its folder', async () => {
    const r = memoryProvider();
    r.setIndex([
      remote({ filename: '../../evil.ttf' }),
      remote({ contentId: '..', filename: 'x.ttf' }),
      remote({ contentId: 'c3', filename: 'a\\b.ttf' }),
      remote({ contentId: 'c4', filename: 'Inter-Bold.ttf' }),
    ]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(fontsHere().map((f) => f.contentId)).toEqual(['c4']);
  });

  test('re-importing a deleted font restores it on the remote', async () => {
    const r = memoryProvider();
    r.setIndex([remote({ deletedAt: 200 })]);
    seed([font({ downloadedAt: 300 })]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(r.files.get('/Readest/fonts/c1/Inter-Regular.ttf')).toBe(BYTES);
    expect(fontsHere()[0]?.deletedAt).toBeUndefined();
    expect(r.index().fonts).toEqual([remote({ addedAt: 300 })]);
  });

  test('a font re-imported elsewhere after a delete here comes back to download', async () => {
    const r = memoryProvider();
    r.setIndex([remote({ addedAt: 300 })]);
    seed([font({ deletedAt: 200 })]);

    await syncFonts(envConfig, r.provider, 'silent');

    expect(fontsHere()).toHaveLength(1);
    expect(fontsHere()[0]).toMatchObject({ id: 'f1', unavailable: true, downloadedAt: 300 });
    expect(fontsHere()[0]?.deletedAt).toBeUndefined();
    expect(r.writes).toEqual([]);
  });

  test('receive-only writes nothing to the remote', async () => {
    const r = memoryProvider();
    r.setIndex([remote({ contentId: 'c2', filename: 'Inter-Bold.ttf' })]);
    seed([font()]);

    await syncFonts(envConfig, r.provider, 'receive');

    expect(r.writes).toEqual([]);
    expect(fontsHere().map((f) => f.contentId)).toEqual(['c1', 'c2']);
  });

  test('send-only changes nothing on this device', async () => {
    const r = memoryProvider();
    r.setIndex([remote({ contentId: 'c2', filename: 'Inter-Bold.ttf' })]);
    seed([font()]);

    await syncFonts(envConfig, r.provider, 'send');

    expect(fontsHere().map((f) => f.contentId)).toEqual(['c1']);
    expect(r.index().fonts.map((f) => f.contentId)).toEqual(['c2', 'c1']);
  });
});

describe('downloadFont', () => {
  test('writes the font file into its bundle dir', async () => {
    const r = memoryProvider();
    r.files.set('/Readest/fonts/c1/Inter-Regular.ttf', BYTES);

    expect(await downloadFont(r.provider, appService as never, font({ unavailable: true }))).toBe(
      true,
    );
    expect(appService.createDir).toHaveBeenCalledWith('b1', 'Fonts', true);
    expect(appService.writeFile).toHaveBeenCalledWith('b1/Inter-Regular.ttf', 'Fonts', BYTES);
  });

  test('reports a font the remote does not hold', async () => {
    const r = memoryProvider();

    expect(await downloadFont(r.provider, appService as never, font({ unavailable: true }))).toBe(
      false,
    );
    expect(appService.writeFile).not.toHaveBeenCalled();
  });
});
