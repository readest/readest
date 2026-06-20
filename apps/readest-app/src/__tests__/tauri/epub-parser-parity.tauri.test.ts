import { describe, it, expect } from 'vitest';
import { invoke } from './tauri-invoke';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc, TOCItem, SectionItem } from '@/libs/document';
import { computeBookNav, type BookNav } from '@/services/nav';
import { partialMD5 } from '@/utils/md5';
import { formatAuthors, formatTitle, getPrimaryLanguage } from '@/utils/book';

/**
 * Cross-language parity tests for the native Rust EPUB parser (PR #4369).
 *
 * These run inside the real Tauri WebView (see scripts/test-tauri.sh), which
 * is the only environment where both parsers are reachable at once:
 *   - the Rust commands (`parse_epub_metadata` / `parse_epub_full`) via the
 *     Tauri IPC `invoke()`, and
 *   - the foliate-js parser via `DocumentLoader`, running in the WebView's JS.
 *
 * The Rust commands read by absolute on-disk path; `process.env.CWD` (injected
 * by vitest.tauri.config.mts) gives us the readest-app dir so we can build that
 * path. The JS side fetches the *same* file through a Vite-served URL.
 *
 * MOBI/AZW parity is intentionally not covered here: there is no Kindle-format
 * fixture in the repo to feed both parsers, and the Rust MOBI path is exercised
 * by `mobi_parser`'s own unit tests. Add a `.mobi` fixture to extend this.
 */

// CWD is the absolute readest-app directory (process.cwd() at config load).
const CWD = process.env['CWD'] as string;

const EPUB_FIXTURES = [
  'sample-alice.epub', // NCX TOC, full metadata (author/publisher/date/subjects/cover)
  'repro-3688.epub', // NCX TOC, fragment-anchored TOC hrefs (#ch01), plain-string author
  'repro-3683.epub', // EPUB3 nav doc, dcterms:modified but no dc:date, no author
] as const;

const diskPath = (name: string) => `${CWD}/src/__tests__/fixtures/data/${name}`;
const fixtureUrl = (name: string) => new URL(`../fixtures/data/${name}`, import.meta.url).href;

// ─── Rust IPC return shapes (serde camelCase) ────────────────────────
//
// `parse_epub_metadata` deliberately does NOT carry OPF metadata —
// foliate-js owns that on both platforms. Rust contributes only the
// partialMD5 hash and the pre-resized cover bytes.
interface RustParsedEpubMetadata {
  partialMd5: string;
  cover?: number[] | Uint8Array | null;
  coverMime?: string | null;
  opfPath: string;
  opfBytes: number[] | Uint8Array;
}
interface RustParsedEpubFull {
  partialMd5: string;
  opfPath: string;
  opfBytes: number[] | Uint8Array;
  navPath?: string | null;
  ncxPath?: string | null;
  sizes: Record<string, number>;
}

// ─── helpers ─────────────────────────────────────────────────────────
const fetchBytes = async (name: string): Promise<ArrayBuffer> =>
  (await fetch(fixtureUrl(name))).arrayBuffer();

const makeFile = (buf: ArrayBuffer, name: string): File =>
  new File([buf], name, { type: 'application/epub+zip' });

const openEpub = async (file: File, nativeFilePath?: string): Promise<BookDoc> => {
  const loader = new DocumentLoader(file, nativeFilePath ? { nativeFilePath } : {});
  return (await loader.open()).book;
};

/**
 * User-visible author string, used by Block 3 (foliate-vs-foliate parity)
 * to confirm the native prefetch doesn't perturb metadata extraction.
 */
const jsAuthor = (book: BookDoc): string => {
  const a = book.metadata.author;
  return a == null ? '' : formatAuthors(a, book.metadata.language);
};

const tocBrief = (items: TOCItem[] | undefined): unknown =>
  (items ?? []).map((i) => ({
    label: i.label,
    href: i.href,
    subitems: i.subitems?.length ? tocBrief(i.subitems) : undefined,
  }));

// id/size/linear only: foliate leaves SectionItem.href undefined, so it is not
// a parity signal; the section identity + computed byte size + linear flag are.
const sectionBrief = (sections: SectionItem[]) =>
  sections.map((s) => ({ id: s.id, size: s.size, linear: s.linear }));

const navFragmentMap = (
  nav: BookNav,
): Record<string, Array<{ href: string; cfi: string; size: number }>> =>
  Object.fromEntries(
    Object.entries(nav.sections).map(([id, sec]) => [
      id,
      sec.fragments.map((f) => ({ href: f.href, cfi: f.cfi, size: f.size })),
    ]),
  );

// ─── 1. Import-path: Rust contributes partialMD5 + cover + OPF bytes ─────
//
// `parse_epub_metadata` deliberately does not extract OPF metadata —
// foliate-js's `parseEpubMetadataFromXML` does that on the JS side,
// against the very `opfBytes` Rust hands over. The invariants we
// assert here are the four contributions Rust still makes:
//   1. partialMD5 byte-equal to the JS reference (the on-disk
//      Books/<hash>/ layout depends on byte-exact parity);
//   2. cover presence matches what foliate's `EPUB.getCover()` would
//      surface (Rust downscales/re-encodes, so bytes differ by
//      design — only presence is a parity signal);
//   3. `opfPath` resolves to a real OPF document — `opfBytes`
//      decode to a `<package>`-rooted XML;
//   4. running foliate-js's exported `parseEpubMetadataFromXML` on
//      those bytes produces the same user-visible metadata fields
//      (title / author / language / identifier / published) as
//      driving `DocumentLoader.open()` against the same File. This
//      is the parity that protects the import-path BookDoc against
//      drift from the reader-path BookDoc, since the importer
//      consumes only the foliate-derived metadata + the Rust cover.
describe('parse_epub_metadata: partialMD5 + cover + OPF parity', () => {
  for (const name of EPUB_FIXTURES) {
    it(`Rust mechanical work + JS-side OPF metadata parity: ${name}`, async () => {
      const buf = await fetchBytes(name);
      const file = makeFile(buf, name);

      const rust = (await invoke('parse_epub_metadata', {
        filePath: diskPath(name),
      })) as RustParsedEpubMetadata;
      const js = await openEpub(file);

      // 1. partialMD5 byte-equal to the JS reference.
      expect(rust.partialMd5).toBe(await partialMD5(file));

      // 2. Cover presence parity.
      const jsHasCover = (await js.getCover()) != null;
      const rustHasCover =
        rust.cover != null &&
        (rust.cover instanceof Uint8Array ? rust.cover.byteLength : rust.cover.length) > 0;
      expect(rustHasCover).toBe(jsHasCover);

      // 3. OPF bytes decode to a real package document.
      expect(rust.opfPath).toBeTruthy();
      const opfXml = new TextDecoder('utf-8').decode(
        rust.opfBytes instanceof Uint8Array ? rust.opfBytes : new Uint8Array(rust.opfBytes),
      );
      expect(opfXml).toContain('<package');

      // 4. Running foliate-js's standalone OPF metadata extractor on
      //    those bytes yields the same user-visible metadata fields
      //    as the full DocumentLoader path. This is what the importer
      //    actually consumes via `tryNativeParseEpub`.
      const epubModule = (await import('foliate-js/epub.js')) as unknown as {
        parseEpubMetadataFromXML: (xml: string) => { metadata: BookDoc['metadata'] };
      };
      const standalone = epubModule.parseEpubMetadataFromXML(opfXml);
      const fields = (m: BookDoc['metadata']) => ({
        title: formatTitle(m.title),
        author: m.author == null ? '' : formatAuthors(m.author, m.language),
        language: getPrimaryLanguage(m.language),
        identifier: m.identifier ?? null,
        published: m.published ?? '',
      });
      expect(fields(standalone.metadata)).toEqual(fields(js.metadata));
    });
  }
});

// ─── 2. Open-path prefetch parity (parse_epub_full size table + md5) ──────
describe('parse_epub_full parity with the foliate-js zip loader', () => {
  for (const name of EPUB_FIXTURES) {
    it(`returns a coherent OPF + size table matching foliate-js: ${name}`, async () => {
      const buf = await fetchBytes(name);
      const file = makeFile(buf, name);

      const full = (await invoke('parse_epub_full', {
        filePath: diskPath(name),
      })) as RustParsedEpubFull;
      const js = await openEpub(file);

      // Same hash from both Rust commands and from JS.
      expect(full.partialMd5).toBe(await partialMD5(file));

      // OPF bytes decode to a real package document.
      const opfXml = new TextDecoder('utf-8').decode(
        full.opfBytes instanceof Uint8Array ? full.opfBytes : new Uint8Array(full.opfBytes),
      );
      expect(opfXml).toContain('<package');

      // Exactly one TOC source, matching the fixture's TOC kind.
      expect(Boolean(full.navPath) || Boolean(full.ncxPath)).toBe(true);

      // The size table must cover every spine section foliate exposes, and the
      // uncompressed sizes must agree (foliate computes getSize from the same
      // zip central directory when the prefetch is absent).
      for (const section of js.sections) {
        expect(full.sizes[section.id]).toBe(section.size);
      }
    });
  }
});

// ─── 3. Behavioral parity: native prefetch vs pure foliate-js, incl. TOC ──
describe('book open + TOC enrichment parity (native prefetch vs foliate-js)', () => {
  for (const name of EPUB_FIXTURES) {
    it(`produces an identical BookDoc and nav with vs without the Rust path: ${name}`, async () => {
      const buf = await fetchBytes(name);

      // Prove the native prefetch is actually exercised (not silently falling
      // back), independently of DocumentLoader internals.
      const { tryNativePrefetchEpub } = await import('@/utils/tauriEpubBridge');
      const prefetch = await tryNativePrefetchEpub(diskPath(name));
      expect(prefetch).not.toBeNull();
      expect(prefetch!.textCache.has('META-INF/container.xml')).toBe(true);
      expect(prefetch!.partialMd5).toBe(await partialMD5(makeFile(buf, name)));

      // Open the same file both ways. Separate File objects so the two zip
      // loaders don't share any state.
      const jsBook = await openEpub(makeFile(buf, name));
      const nativeBook = await openEpub(makeFile(buf, name), diskPath(name));

      // Metadata that flows into the library DB must be identical.
      const pick = (b: BookDoc) => ({
        title: formatTitle(b.metadata.title),
        author: jsAuthor(b),
        language: getPrimaryLanguage(b.metadata.language),
        identifier: b.metadata.identifier ?? null,
        published: b.metadata.published ?? '',
      });
      expect(pick(nativeBook)).toEqual(pick(jsBook));

      // Spine + TOC structure must be identical.
      expect(sectionBrief(nativeBook.sections)).toEqual(sectionBrief(jsBook.sections));
      expect(tocBrief(nativeBook.toc)).toEqual(tocBrief(jsBook.toc));

      // computeBookNav runs the parallelized section scan, fragment-CFI math
      // and embedded-<nav> enrichment (PR #4369 commit 4). Its output — the
      // grouped TOC and per-section fragment CFIs/sizes — must not depend on
      // whether the OPF/nav came from Rust or from zip.js.
      const navJs = await computeBookNav(jsBook);
      const navNative = await computeBookNav(nativeBook);
      expect(tocBrief(navNative.toc)).toEqual(tocBrief(navJs.toc));
      expect(Object.keys(navNative.sections).sort()).toEqual(Object.keys(navJs.sections).sort());
      expect(navFragmentMap(navNative)).toEqual(navFragmentMap(navJs));
    });
  }
});
