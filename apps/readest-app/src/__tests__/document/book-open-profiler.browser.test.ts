/// <reference types="vite/client" />
import { describe, it, beforeAll, afterEach, afterAll } from 'vitest';
import {
  DocumentLoader,
  buildBookCache,
  type BookDoc,
  type TOCCacheContext,
} from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { bookProfiler, type ProfileSession } from '@/utils/bookProfiler';
import { WebAppService } from '@/services/webAppService';
import { partialMD5 } from '@/utils/md5';

const MIME_TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
};

// Vite resolves all book files in the fixtures directory at build time and
// serves them as static assets, so fetch() can reach them at runtime.
const bookGlob = import.meta.glob(
  [
    '../fixtures/data/*.epub',
    '../fixtures/data/*.pdf',
    '../fixtures/data/*.mobi',
    '../fixtures/data/*.azw',
    '../fixtures/data/*.azw3',
    '../fixtures/data/*.fb2',
    '../fixtures/data/*.cbz',
    '../fixtures/data/*.cbr',
  ],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

const FIXTURES = Object.entries(bookGlob)
  .map(([path, url]) => {
    const name = path.split('/').pop()!;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return { name, url, mime: MIME_TYPES[ext] ?? 'application/octet-stream' };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/** Clear all records from the IndexedDB object store without deleting the database. */
async function clearStore() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('AppFileSystem', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

describe('Book-open profiler (browser)', () => {
  let view: FoliateView | null = null;
  let service: WebAppService;
  const allSessions: ProfileSession[] = [];
  /** Maps fixture filename → book hash for TOC cache lookup */
  const fixtureHashes = new Map<string, string>();

  beforeAll(async () => {
    // Set up WebAppService with IDB — same code path as the web app.
    await clearStore();
    service = new WebAppService();
    await service.init();

    // Pre-write all fixtures into IDB as Blobs so openFile() returns an IDBFile
    // with lazy slice semantics (bytes stay on disk until zip.js requests them).
    for (const fixture of FIXTURES) {
      const resp = await fetch(fixture.url);
      const buffer = await resp.arrayBuffer();
      await service.fs.writeFile(fixture.name, 'Books', buffer);
    }

    // Pre-cache TOC for every EPUB fixture so the profiled run uses the fast path.
    for (const fixture of FIXTURES) {
      if (fixture.mime !== 'application/epub+zip') continue;
      const file = await service.fs.openFile(fixture.name, 'Books', fixture.name);
      const hash = await partialMD5(file);
      fixtureHashes.set(fixture.name, hash);
      try {
        const { book } = await new DocumentLoader(file).open();
        await service.fs.writeFile(
          `${hash}/book.json`,
          'Cache',
          JSON.stringify(buildBookCache(book)),
        );
      } catch {
        // Non-EPUB or parse error — skip caching for this fixture
      }
    }

    // Import and register the foliate-view custom element once for the suite.
    await import('foliate-js/view.js');
  }, 120_000);

  afterEach(async () => {
    if (view) {
      // Let the browser finish any pending microtasks before tearing down.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        view.close();
      } catch {
        /* iframe body may already be torn down */
      }
      view.remove();
      view = null;
    }
    bookProfiler.clear();
  });

  afterAll(async () => {
    await clearStore();
    if (allSessions.length > 0) {
      console.warn('\n=== Book-open profiler: combined report ===\n');
      allSessions.forEach((s) => console.warn(bookProfiler.formatSession(s) + '\n'));
    }
  });

  for (const fixture of FIXTURES) {
    it(`profiles open pipeline: ${fixture.name}`, async () => {
      // ── Stage 0: Open from IDB via IDBFile (mirrors bookService.loadBookContent) ──
      bookProfiler.startSession(fixture.name);
      bookProfiler.mark('initViewState-start');

      performance.mark('[load-content] exists-start');
      const exists = await service.fs.exists(fixture.name, 'Books');
      performance.mark('[load-content] exists-done');
      if (!exists) {
        console.warn(`Fixture not found in IDB: ${fixture.name} — skipping`);
        bookProfiler.clear();
        return;
      }
      const file = await service.fs.openFile(fixture.name, 'Books', fixture.name);
      performance.mark('[load-content] openFile-local-done');
      bookProfiler.mark('loadBookContent-done');
      bookProfiler.injectSubMarks('[load-content]');

      // ── Stage 1: DocumentLoader.open() — parses the book ──
      const bookHash = fixtureHashes.get(fixture.name);
      const cacheContext: TOCCacheContext | undefined = bookHash
        ? { bookHash, fs: service.fs }
        : undefined;
      let bookDoc: BookDoc;
      try {
        const result = await new DocumentLoader(file, cacheContext).open();
        bookDoc = result.book;
      } catch (e) {
        console.warn(`Skipping ${fixture.name}: DocumentLoader failed — ${e}`);
        bookProfiler.clear();
        return;
      }
      bookProfiler.mark('documentLoader-done');
      bookProfiler.injectSubMarks('[epub-open]');

      // In the standalone test there is no config system; mark immediately
      // so the 9-mark schema is preserved for comparison with app timing.
      bookProfiler.mark('loadBookConfig-done');

      // ── Stage 2: Create foliate-view element ──
      bookProfiler.mark('openBook-start');
      // import('foliate-js/view.js') was already cached in beforeAll; this
      // mirrors the FoliateViewer.tsx code path but at near-zero cost.
      bookProfiler.mark('foliate-import-done');

      view = document.createElement('foliate-view') as FoliateView;
      Object.assign(view.style, {
        width: '1280px',
        height: '800px',
        position: 'absolute',
        left: '0',
        top: '0',
      });
      document.body.appendChild(view);

      // ── Stage 3: view.open(bookDoc) — hands the parsed book to foliate ──
      await view.open(bookDoc);
      bookProfiler.mark('view-open-done');

      // ── Stage 4: navigate to start, wait for renderer to stabilize ──
      // Register the stabilized listener BEFORE calling goToFraction so we
      // don't miss a synchronous dispatch.
      const stabilized = new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          console.warn(`stabilized timeout for ${fixture.name} — skipping`);
          resolve();
        }, 15_000);
        view!.renderer.addEventListener(
          'stabilized',
          () => {
            clearTimeout(t);
            bookProfiler.mark('stabilized');
            resolve();
          },
          { once: true },
        );
      });

      await view.goToFraction(0);
      bookProfiler.mark('view-init-done');

      await stabilized;

      // ── Report ──
      const session = bookProfiler.endSession();
      if (session) {
        allSessions.push(session);
      }
    }, 90_000);
  }
});
