import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AppService, BaseDir } from '@/types/system';
import type { GlossIndexData } from '@/services/wordwise/types';
import type {
  BytesDownloader,
  WordWiseManifest,
  WordWisePack,
} from '@/services/wordwise/glossPacks';

// Fresh module instance per test so the in-session memos (manifestPromise,
// indexCache, ensureFlights, storeDirReady) start clean — via vi.resetModules()
// instead of a production-side reset helper.
const importGlossPacks = () => import('@/services/wordwise/glossPacks');

// ---- in-memory fake AppService (only the file IO glossPacks touches) ----
// Mirrors the REAL web appService: writeFile stores content verbatim and a 'text'
// read returns it UN-decoded (an ArrayBuffer stays an ArrayBuffer). This is what
// broke loadGlossIndex when the pack was written as bytes — keep the fake faithful
// so the suite guards that class of bug instead of hiding it.
const createFakeAppService = (): {
  appService: AppService;
  store: Map<string, string | ArrayBuffer>;
} => {
  const store = new Map<string, string | ArrayBuffer>();
  const key = (path: string, base: BaseDir) => `${base}:${path}`;
  const encoder = new TextEncoder();

  const appService = {
    appPlatform: 'web',
    async exists(path: string, base: BaseDir) {
      return store.has(key(path, base));
    },
    async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
      if (!store.has(key(path, base))) throw new Error(`ENOENT: ${key(path, base)}`);
      const content = store.get(key(path, base))!;
      // 'text' returns the stored value verbatim (no decode, like web); 'binary'
      // coerces a stored string to an ArrayBuffer.
      if (mode === 'text') return content;
      return typeof content === 'string'
        ? (encoder.encode(content).buffer as ArrayBuffer)
        : content;
    },
    async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File) {
      store.set(key(path, base), content as string | ArrayBuffer);
    },
    async deleteFile(path: string, base: BaseDir) {
      store.delete(key(path, base));
    },
    async createDir() {
      /* no-op: flat in-memory store */
    },
  } as unknown as AppService;

  return { appService, store };
};

// sha256 hex of bytes, matching glossPacks' own hashing.
const sha256Hex = async (buf: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const packData: GlossIndexData = {
  meta: { source: 'en', target: 'zh', metric: 'frq', version: 1, count: 1 },
  entries: { cryptic: { r: 18000, g: '晦涩的' } },
  inflections: {},
};

const packBytes = (): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(packData)).buffer as ArrayBuffer;

const makePack = (overrides: Partial<WordWisePack>, sha: string): WordWisePack => ({
  pair: 'en-zh',
  source: 'en',
  target: 'zh',
  file: 'en-zh.json',
  bytes: packBytes().byteLength,
  sha256: sha,
  entries: 1,
  ...overrides,
});

describe('glossPacks', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('downloadViaTempFile', () => {
    // Fake AppService where the temp file lives at an ABSOLUTE path. The bug
    // was: download wrote to a CWD-relative path while the read resolved against
    // 'Data' → write dst !== read dst → read threw. This fake keys its store by
    // the absolute path and only resolves base 'None' against it, so the test
    // passes only when the download dst and the read path are the same absolute
    // path (the fix). The old relative-path code reads at a different key and
    // throws, failing the test.
    const createAbsAppService = (): { appService: AppService; map: Map<string, ArrayBuffer> } => {
      const map = new Map<string, ArrayBuffer>();
      const appService = {
        appPlatform: 'tauri',
        // 'Data' relative path -> absolute path under a fake Data root.
        async resolveFilePath(path: string, base: BaseDir) {
          expect(base).toBe('Data');
          return `/abs/Data/${path}`;
        },
        async readFile(path: string, base: BaseDir, mode: 'text' | 'binary') {
          expect(base).toBe('None'); // absolute path addressed with base 'None'
          const buf = map.get(path);
          if (!buf) throw new Error(`ENOENT: ${path}`);
          return mode === 'binary' ? buf : new TextDecoder().decode(buf);
        },
        async deleteFile(path: string, base: BaseDir) {
          expect(base).toBe('None');
          map.delete(path);
        },
        async createDir() {
          /* stubbed */
        },
        async exists() {
          return false;
        },
      } as unknown as AppService;
      return { appService, map };
    };

    it('downloads to an absolute temp path, reads back the SAME path, then deletes it', async () => {
      const { downloadViaTempFile } = await importGlossPacks();
      const { appService, map } = createAbsAppService();
      const bytes = packBytes();

      // Fake Rust downloader: write the bytes into the map at the exact `dst`
      // it was handed (the absolute path). Read must use that same path.
      const downloadFileFn = vi.fn(async ({ dst }: { dst: string }) => {
        expect(dst.startsWith('/abs/Data/wordwise/.dl-')).toBe(true);
        map.set(dst, bytes);
        return new Headers();
      });

      const result = await downloadViaTempFile(appService, downloadFileFn, 'https://x/pack.json');

      // Returns the downloaded bytes → proves write dst === read dst.
      expect(new TextDecoder().decode(result)).toBe(new TextDecoder().decode(bytes));
      expect(downloadFileFn).toHaveBeenCalledTimes(1);
      // Temp file deleted afterward.
      expect(map.size).toBe(0);
    });
  });

  describe('resolvePack', () => {
    it('picks the pack matching (source, target)', async () => {
      const { resolvePack } = await importGlossPacks();
      const manifest: WordWiseManifest = {
        schemaVersion: 1,
        packs: [
          makePack({ pair: 'en-zh', source: 'en', target: 'zh' }, 'a'),
          makePack({ pair: 'zh-en', source: 'zh', target: 'en', file: 'zh-en.json' }, 'b'),
        ],
      };
      expect(resolvePack(manifest, 'en', 'zh')?.pair).toBe('en-zh');
      expect(resolvePack(manifest, 'zh', 'en')?.pair).toBe('zh-en');
    });

    it('returns null when no pack matches', async () => {
      const { resolvePack } = await importGlossPacks();
      const manifest: WordWiseManifest = {
        schemaVersion: 1,
        packs: [makePack({ source: 'en', target: 'zh' }, 'a')],
      };
      expect(resolvePack(manifest, 'en', 'fr')).toBeNull();
      expect(resolvePack(null, 'en', 'zh')).toBeNull();
    });
  });

  describe('ensurePack', () => {
    it('downloads when absent, verifies sha, writes file + sidecar, returns the path', async () => {
      const { ensurePack } = await importGlossPacks();
      const { appService, store } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const download: BytesDownloader = vi.fn(async () => packBytes());

      const path = await ensurePack(appService, pack, { download });

      expect(path).toBe('wordwise/en-zh.json');
      expect(download).toHaveBeenCalledTimes(1);
      expect(await appService.exists('wordwise/en-zh.json', 'Data')).toBe(true);
      expect(await appService.readFile('wordwise/en-zh.json.sha', 'Data', 'text')).toBe(sha);
      expect(store.size).toBe(2);
    });

    it('reuses the local file (no download) when file + matching sidecar exist', async () => {
      const { ensurePack } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      // Seed local file + sidecar.
      await appService.writeFile('wordwise/en-zh.json', 'Data', packBytes());
      await appService.writeFile('wordwise/en-zh.json.sha', 'Data', sha);
      const download: BytesDownloader = vi.fn(async () => packBytes());

      const path = await ensurePack(appService, pack, { download });

      expect(path).toBe('wordwise/en-zh.json');
      expect(download).not.toHaveBeenCalled();
    });

    it('returns null and does not persist when downloaded bytes sha != pack.sha256', async () => {
      const { ensurePack } = await importGlossPacks();
      const { appService, store } = createFakeAppService();
      const pack = makePack({}, 'deadbeef'); // wrong expected sha
      const download: BytesDownloader = vi.fn(async () => packBytes());

      const path = await ensurePack(appService, pack, { download });

      expect(path).toBeNull();
      expect(await appService.exists('wordwise/en-zh.json', 'Data')).toBe(false);
      expect(store.size).toBe(0);
    });

    it('single-flights concurrent calls for the same pair (download once)', async () => {
      const { ensurePack } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const download: BytesDownloader = vi.fn(async () => packBytes());

      const [a, b] = await Promise.all([
        ensurePack(appService, pack, { download }),
        ensurePack(appService, pack, { download }),
      ]);

      expect(a).toBe('wordwise/en-zh.json');
      expect(b).toBe('wordwise/en-zh.json');
      expect(download).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadGlossIndex', () => {
    it('manifest -> resolve -> ensure -> read -> GlossIndex that looks up a word', async () => {
      const { loadGlossIndex } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const manifest: WordWiseManifest = { schemaVersion: 1, packs: [pack] };

      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      const download: BytesDownloader = vi.fn(async (url: string) =>
        url.includes('manifest.json') ? manifestBytes : packBytes(),
      );

      const index = await loadGlossIndex(appService, 'en', 'zh', { download });
      expect(index).not.toBeNull();
      expect(index!.lookup('cryptic')).toEqual({ rank: 18000, gloss: '晦涩的' });
    });

    it('loads a pack cached as a raw ArrayBuffer (pre-fix web verbatim storage)', async () => {
      const { loadGlossIndex } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      // Seed the cache the OLD way: pack stored as a raw ArrayBuffer (+ sidecar).
      // A 'text' read returns the ArrayBuffer verbatim, so loadGlossIndex must
      // decode it rather than JSON.parse("[object ArrayBuffer]").
      await appService.writeFile('wordwise/en-zh.json', 'Data', packBytes());
      await appService.writeFile('wordwise/en-zh.json.sha', 'Data', sha);
      const manifest: WordWiseManifest = { schemaVersion: 1, packs: [pack] };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      // Only the manifest is fetched; the pack is already cached.
      const download: BytesDownloader = vi.fn(async () => manifestBytes);

      const index = await loadGlossIndex(appService, 'en', 'zh', {
        download,
        allowDownload: false,
      });
      expect(index).not.toBeNull();
      expect(index!.lookup('cryptic')).toEqual({ rank: 18000, gloss: '晦涩的' });
    });

    it('returns null when the manifest has no pack for the pair', async () => {
      const { loadGlossIndex } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const manifest: WordWiseManifest = { schemaVersion: 1, packs: [] };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      const download: BytesDownloader = vi.fn(async () => manifestBytes);

      const index = await loadGlossIndex(appService, 'en', 'fr', { download });
      expect(index).toBeNull();
    });
  });

  describe('allowDownload', () => {
    it('ensurePack with allowDownload:false returns null and never downloads when uncached', async () => {
      const { ensurePack } = await importGlossPacks();
      const { appService, store } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const download: BytesDownloader = vi.fn(async () => packBytes());

      const path = await ensurePack(appService, pack, { download, allowDownload: false });

      expect(path).toBeNull();
      expect(download).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    });

    it('ensurePack with allowDownload:false returns the cached path without downloading', async () => {
      const { ensurePack } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      await appService.writeFile('wordwise/en-zh.json', 'Data', packBytes());
      await appService.writeFile('wordwise/en-zh.json.sha', 'Data', sha);
      const download: BytesDownloader = vi.fn(async () => packBytes());

      const path = await ensurePack(appService, pack, { download, allowDownload: false });

      expect(path).toBe('wordwise/en-zh.json');
      expect(download).not.toHaveBeenCalled();
    });

    it('loadGlossIndex with allowDownload:false never downloads the pack when uncached', async () => {
      const { loadGlossIndex } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const manifest: WordWiseManifest = { schemaVersion: 1, packs: [pack] };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      // Manifest still downloads; the *pack* must not.
      const download: BytesDownloader = vi.fn(async (url: string) => {
        if (url.includes('manifest.json')) return manifestBytes;
        throw new Error('pack download must not happen with allowDownload:false');
      });

      const index = await loadGlossIndex(appService, 'en', 'zh', {
        download,
        allowDownload: false,
      });
      expect(index).toBeNull();
    });
  });

  describe('getPackStatus', () => {
    const buildManifest = (pack: WordWisePack): WordWiseManifest => ({
      schemaVersion: 1,
      packs: [pack],
    });

    it('reports downloaded=false before ensurePack, then true after', async () => {
      const { getPackStatus, ensurePack } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const manifest = buildManifest(pack);
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      const download: BytesDownloader = vi.fn(async (url: string) =>
        url.includes('manifest.json') ? manifestBytes : packBytes(),
      );

      const before = await getPackStatus(appService, 'en', 'zh', { download });
      expect(before).not.toBeNull();
      expect(before!.pack.pair).toBe('en-zh');
      expect(before!.downloaded).toBe(false);

      await ensurePack(appService, pack, { download });

      const after = await getPackStatus(appService, 'en', 'zh', { download });
      expect(after!.downloaded).toBe(true);
    });

    it('returns null when the manifest has no pack for the pair', async () => {
      const { getPackStatus } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const manifest: WordWiseManifest = { schemaVersion: 1, packs: [] };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      const download: BytesDownloader = vi.fn(async () => manifestBytes);

      const status = await getPackStatus(appService, 'en', 'fr', { download });
      expect(status).toBeNull();
    });
  });

  describe('deletePack', () => {
    it('removes the pack file + sidecar so getPackStatus flips back to false', async () => {
      const { getPackStatus, ensurePack, deletePack } = await importGlossPacks();
      const { appService, store } = createFakeAppService();
      const sha = await sha256Hex(packBytes());
      const pack = makePack({}, sha);
      const manifest: WordWiseManifest = { schemaVersion: 1, packs: [pack] };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      const download: BytesDownloader = vi.fn(async (url: string) =>
        url.includes('manifest.json') ? manifestBytes : packBytes(),
      );

      await ensurePack(appService, pack, { download });
      expect((await getPackStatus(appService, 'en', 'zh', { download }))!.downloaded).toBe(true);

      await deletePack(appService, pack);

      expect(await appService.exists('wordwise/en-zh.json', 'Data')).toBe(false);
      expect(await appService.exists('wordwise/en-zh.json.sha', 'Data')).toBe(false);
      // Only the persisted manifest remains.
      expect(store.has('Data:wordwise/manifest.json')).toBe(true);
      expect((await getPackStatus(appService, 'en', 'zh', { download }))!.downloaded).toBe(false);
    });

    it('ignores a missing file', async () => {
      const { deletePack } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const pack = makePack({}, 'abc');
      await expect(deletePack(appService, pack)).resolves.toBeUndefined();
    });
  });

  describe('listAvailableTargets', () => {
    it('returns the target codes the manifest offers for a source', async () => {
      const { listAvailableTargets } = await importGlossPacks();
      const manifest: WordWiseManifest = {
        schemaVersion: 1,
        packs: [
          makePack({ pair: 'en-zh', source: 'en', target: 'zh' }, 'a'),
          makePack({ pair: 'en-fr', source: 'en', target: 'fr', file: 'en-fr.json' }, 'b'),
          makePack({ pair: 'zh-en', source: 'zh', target: 'en', file: 'zh-en.json' }, 'c'),
        ],
      };
      expect(listAvailableTargets(manifest, 'en').sort()).toEqual(['fr', 'zh']);
      expect(listAvailableTargets(manifest, 'zh')).toEqual(['en']);
      expect(listAvailableTargets(manifest, 'de')).toEqual([]);
      expect(listAvailableTargets(null, 'en')).toEqual([]);
    });
  });

  describe('fetchManifest', () => {
    it('downloads, persists to Data, then serves the persisted copy when offline', async () => {
      const { fetchManifest } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const manifest: WordWiseManifest = {
        schemaVersion: 1,
        packs: [makePack({}, 'abc')],
      };
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
        .buffer as ArrayBuffer;
      const download: BytesDownloader = vi.fn(async () => manifestBytes);

      const first = await fetchManifest(appService, { download });
      expect(first?.packs[0]?.pair).toBe('en-zh');
      expect(await appService.exists('wordwise/manifest.json', 'Data')).toBe(true);

      // force: true bypasses the in-session memo, so we re-attempt the (now
      // offline) download and fall back to the persisted copy.
      const offlineDownload: BytesDownloader = vi.fn(async () => {
        throw new Error('offline');
      });
      const second = await fetchManifest(appService, { download: offlineDownload, force: true });
      expect(second?.packs[0]?.pair).toBe('en-zh');
    });

    it('returns null when network fails and no persisted copy exists', async () => {
      const { fetchManifest } = await importGlossPacks();
      const { appService } = createFakeAppService();
      const download: BytesDownloader = vi.fn(async () => {
        throw new Error('offline');
      });
      const result = await fetchManifest(appService, { download });
      expect(result).toBeNull();
    });
  });
});
