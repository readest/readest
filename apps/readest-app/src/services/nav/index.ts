import { ConvertChineseVariant } from '@/types/book';
import { BookDoc, SectionFragment, TOCItem } from '@/libs/document';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';
import { runWithConcurrency } from '@/utils/concurrency';
import {
  cloneSectionFragments,
  cloneTocItems,
  collectAllTocItems,
  groupItemsBySection,
  groupTocSubitems,
} from './grouping';
import { bakeLocationsAndCfis, sortTocItems } from './locations';
import { buildSectionFragments } from './fragments';
import { enrichTocFromNavElements } from './enrichment';

/**
 * Bound on simultaneous in-flight section reads during nav build.
 *
 * The original perf commit fanned every section out via Promise.all under
 * the assumption that `section.loadText()` is a cheap in-memory inflate.
 * That holds for pure-web targets (the EPUB Blob is an in-memory File
 * backed by IndexedDB, slice/arrayBuffer is synchronous), but on Tauri
 * each loadText drives a `@tauri-apps/plugin-fs` open/read/close round
 * trip across the JS<->Rust IPC bridge: see `utils/file.ts::NativeFile`.
 * Past a per-platform threshold the bridge or the fd pool saturates,
 * individual reads reject, and the zip.js TextWriter driving that
 * entry's inflate transitions to ERRORED, surfacing as
 *   "Cannot close a ERRORED writable stream"
 * with the affected sections silently losing their TOC fragments.
 *
 * The cap was picked empirically against the worst-case combination we
 * could reproduce — Android emulator + dev mode + a 250-section EPUB —
 * binary-searching the threshold:
 *   - 30 ✅, 64 ✅, 128 ✅
 *   - 200 ❌ (≈ 30 contiguous sections fail with the ERRORED message)
 * Real devices (release build, native fd pool, no Next.js dev tooling
 * sharing the event loop) sit well above this, so 128 leaves a healthy
 * margin while preserving close-to-unbounded cross-section inflate
 * overlap during cold nav build (CPU `parseFromString` for one section
 * runs while the next several inflate). Higher caps yield diminishing
 * returns: parseFromString is CPU-bound on the main thread and
 * dominates total nav-build time once IPC latency is paid in parallel.
 *
 * Failure-isolation note: `runWithConcurrency` swallows per-task
 * exceptions into the result tuple, so even if a future workload pushes
 * past this cap on an unfamiliar platform, individual section failures
 * degrade gracefully (the caller logs them and skips the offending
 * fragments) instead of aborting the whole nav build the way the
 * original Promise.all path did.
 */
const NAV_BUILD_CONCURRENCY = 128;

export { findParentPath, findTocItemBS } from './lookup';
export type { SectionFragment };

// -----------------------------------------------------------------------------
// Book navigation artifact (persisted to Books/{hash}/nav.json).
// Bump BOOK_NAV_VERSION whenever computeBookNav output semantics change
// (TOC grouping heuristic, fragment CFI/size math, hierarchy rules).
// v2: fragment CFIs are derived from the section DOM via CFI.joinIndir instead
//     of inherited from the TOC item (ported from foliate-js 317051e).
// v3: nav-enrichment fallback — when toc.ncx is sparse, scan section HTMLs for
//     embedded <nav> elements and merge their links as top-level TOC items.
// -----------------------------------------------------------------------------

export const BOOK_NAV_VERSION = 3;

export interface BookNavSection {
  id: string;
  fragments: SectionFragment[];
}

export interface BookNav {
  version: number;
  toc: TOCItem[];
  sections: Record<string, BookNavSection>;
}

const convertTocLabels = (items: TOCItem[], convertChineseVariant: ConvertChineseVariant) => {
  items.forEach((item) => {
    if (item.label) {
      item.label = runSimpleCC(item.label, convertChineseVariant);
    }
    if (item.subitems) {
      convertTocLabels(item.subitems, convertChineseVariant);
    }
  });
};

// Per-open transformations: label conversion (user setting) and optional sort.
// Structural location/cfi baking lives in computeBookNav/hydrateBookNav so
// the cached BookNav carries the expensive-to-derive fields across opens.
export const updateToc = async (
  bookDoc: BookDoc,
  sortedTOC: boolean,
  convertChineseVariant: ConvertChineseVariant,
) => {
  if (bookDoc.rendition?.layout === 'pre-paginated') return;

  const items = bookDoc?.toc || [];
  if (!items.length) return;

  if (convertChineseVariant && convertChineseVariant !== 'none') {
    await initSimpleCC();
    convertTocLabels(items, convertChineseVariant);
  }

  if (sortedTOC) sortTocItems(items);
};

/**
 * Compute a per-book navigation artifact from a freshly opened BookDoc.
 * Expensive: for each referenced section, loads the HTML text and parses the
 * XHTML DOM to compute per-fragment CFIs (via CFI.joinIndir) and byte-size
 * offsets between TOC-fragment anchors. Intended to run on cache miss; the
 * result is persisted to Books/{hash}/nav.json and replayed via
 * hydrateBookNav on subsequent opens.
 */
export const computeBookNav = async (bookDoc: BookDoc): Promise<BookNav> => {
  const tocClone = cloneTocItems(bookDoc.toc ?? []);
  const sections: Record<string, BookNavSection> = {};
  const enrichedNav = await enrichTocFromNavElements(bookDoc, tocClone);

  if (tocClone.length) {
    groupTocSubitems(bookDoc, tocClone);
  }

  const bookSections = bookDoc.sections ?? [];
  if (!tocClone.length || !bookSections.length) {
    return { version: BOOK_NAV_VERSION, toc: tocClone, sections };
  }

  const sectionMap = new Map(bookSections.map((s) => [s.id, s]));
  const allItems = collectAllTocItems(tocClone);
  const groups = groupItemsBySection(bookDoc, allItems);
  const splitHref = (href: string) => bookDoc.splitTOCHref(href);

  // Process sections with a bounded worker pool. Each section's work is
  // independent: the only shared writes are into `sections` (keyed by
  // sectionId, no collisions) and into `bookSections` later (after all
  // workers settle). The cross-section inflate overlap that motivated the
  // original parallel rewrite is preserved — we just cap simultaneous
  // in-flight reads at NAV_BUILD_CONCURRENCY so we don't saturate the
  // platform's IPC bridge / fd pool. See the constant's docblock for the
  // failure mode that drove this cap.
  type SectionEntry = [string, BookNavSection];
  const taskOutcomes = await runWithConcurrency(
    Array.from(groups.entries()),
    NAV_BUILD_CONCURRENCY,
    async ([sectionId, { base, fragments }]): Promise<SectionEntry | null> => {
      const section = sectionMap.get(sectionId);
      if (!section || fragments.length === 0) return null;
      if (!section.loadText) return null;

      // Issue both the raw-text and DOM-parse loads concurrently within
      // this section. makeZipLoader's in-flight loadText dedupe (see
      // libs/document.ts) collapses these onto a single zip inflate when
      // both await the same href in the same microtask span, so the cost
      // is one read + one parse, not two reads.
      const contentP = section.loadText();
      const docP = section.createDocument().catch((e: unknown) => {
        console.warn(`Failed to parse section ${sectionId} for fragment CFIs:`, e);
        return null;
      });
      const [content, doc] = await Promise.all([contentP, docP]);
      if (!content) return null;
      if (!doc) return null;

      const sectionFragments = buildSectionFragments(
        section,
        fragments,
        base,
        content,
        doc,
        splitHref,
      );
      if (sectionFragments.length === 0) return null;
      return [sectionId, { id: sectionId, fragments: sectionFragments }];
    },
  );

  for (const outcome of taskOutcomes) {
    if ('error' in outcome) {
      const [sectionId] = outcome.item;
      console.warn(`Failed to build section ${sectionId} for fragment CFIs:`, outcome.error);
      continue;
    }
    if (outcome.result) {
      const [id, section] = outcome.result;
      sections[id] = section;
    }
  }

  // Attach the freshly computed fragments to live sections so the bake can see
  // them via createSectionsMap. hydrateBookNav on the same bookDoc (called
  // right after by readerStore) will re-clone these, so the shared-ref write
  // here is a temporary staging step.
  for (const section of bookSections) {
    section.fragments = sections[section.id]?.fragments;
  }
  bakeLocationsAndCfis(tocClone, bookSections, splitHref);

  if (enrichedNav) {
    sortTocItems(tocClone);
  }

  return { version: BOOK_NAV_VERSION, toc: tocClone, sections };
};

/**
 * Apply a cached BookNav onto a freshly opened BookDoc, replacing its TOC
 * with the cached (post-grouping) version and attaching per-section
 * fragments to the corresponding Section objects, then (re)derive
 * section/fragment locations and TOC item cfi+location. Pure; no I/O.
 */
export const hydrateBookNav = (bookDoc: BookDoc, bookNav: BookNav): void => {
  bookDoc.toc = cloneTocItems(bookNav.toc);
  const bookSections = bookDoc.sections ?? [];
  for (const section of bookSections) {
    const cached = bookNav.sections[section.id];
    if (cached?.fragments?.length) {
      section.fragments = cloneSectionFragments(cached.fragments);
    } else {
      section.fragments = undefined;
    }
  }
  bakeLocationsAndCfis(bookDoc.toc ?? [], bookSections, (h) => bookDoc.splitTOCHref(h));
};
