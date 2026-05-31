import { describe, it, expect } from 'vitest';
import { invoke } from './tauri-invoke';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc, TOCItem, SectionItem, BookMetadata } from '@/libs/document';
import { computeBookNav, type BookNav } from '@/services/nav';
import { partialMD5 } from '@/utils/md5';
import {
  formatAuthors,
  formatDescription,
  formatPublisher,
  formatTitle,
  getPrimaryLanguage,
} from '@/utils/book';

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
interface RustMetadata {
  title?: string | null;
  authors?: string[] | null;
  language?: string | null;
  identifier?: string | null;
  isbn?: string | null;
  publisher?: string | null;
  published?: string | null;
  description?: string | null;
  subject?: string[] | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
}
interface RustParsedEpubMetadata {
  partialMd5: string;
  metadata: RustMetadata;
  coverBase64?: string | null;
  coverMime?: string | null;
  coverZipPath?: string | null;
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
 * User-visible author string. Rust returns `string[]`, foliate returns a
 * `string | Contributor | array`; running both through the app's own
 * `formatAuthors` normalizes list/sortAs handling so we compare the value the
 * user actually sees rather than the raw parser shape.
 */
const jsAuthor = (book: BookDoc): string => {
  const a = book.metadata.author;
  return a == null ? '' : formatAuthors(a, book.metadata.language);
};
const rustAuthor = (m: RustMetadata, lang: string | string[] | undefined): string =>
  m.authors?.length ? formatAuthors(m.authors, lang) : '';

const toStringArray = (s: BookMetadata['subject'] | string[] | null | undefined): string[] => {
  if (!s) return [];
  const arr = Array.isArray(s) ? s : [s];
  return arr
    .map((v) => (typeof v === 'string' ? v : String(v?.name ?? '')))
    .filter(Boolean)
    .sort();
};

// foliate normalizes internal whitespace in descriptions (e.g. a source
// newline becomes a space); Rust preserves the raw text. Both strip tags via
// formatDescription — collapse runs of whitespace so we compare the words,
// not the publisher's line wrapping.
const normDesc = (d: string | undefined): string =>
  formatDescription(d).replace(/\s+/g, ' ').trim();

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

// ─── 1. Import-path metadata parity (parse_epub_metadata vs foliate-js) ──
describe('parse_epub_metadata parity with foliate-js', () => {
  for (const name of EPUB_FIXTURES) {
    it(`extracts the same metadata as foliate-js: ${name}`, async () => {
      const buf = await fetchBytes(name);
      const file = makeFile(buf, name);

      const rust = (await invoke('parse_epub_metadata', {
        filePath: diskPath(name),
      })) as RustParsedEpubMetadata;
      const js = await openEpub(file);

      // partialMD5 — the on-disk Books/<hash>/ layout depends on byte-exact
      // parity here; a divergence would silently re-import every book.
      expect(rust.partialMd5).toBe(await partialMD5(file));

      expect(formatTitle(rust.metadata.title ?? '')).toBe(formatTitle(js.metadata.title));
      expect(rustAuthor(rust.metadata, rust.metadata.language ?? undefined)).toBe(jsAuthor(js));
      expect(getPrimaryLanguage(rust.metadata.language ?? undefined)).toBe(
        getPrimaryLanguage(js.metadata.language),
      );
      expect(rust.metadata.identifier ?? null).toBe(js.metadata.identifier ?? null);
      expect(formatPublisher(rust.metadata.publisher ?? '')).toBe(
        formatPublisher(js.metadata.publisher ?? ''),
      );
      expect(rust.metadata.published ?? '').toBe(js.metadata.published ?? '');
      expect(toStringArray(rust.metadata.subject)).toEqual(toStringArray(js.metadata.subject));
      expect(normDesc(rust.metadata.description ?? undefined)).toBe(
        normDesc(js.metadata.description),
      );

      // Cover presence parity (Rust downscales/re-encodes, so bytes differ by
      // design — only the presence of a cover is a parity signal).
      const jsHasCover = (await js.getCover()) != null;
      expect(rust.coverBase64 != null).toBe(jsHasCover);
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
