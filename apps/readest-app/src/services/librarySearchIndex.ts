import type { Book } from '@/types/book';
import type { DatabaseRow, DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import { foldValue } from '@/utils/containsSearch';

/**
 * Per-book search index/cache: `<Books>/<hash>/search.db`, beside cover.png.
 * Holds the section text extracted by the search pipeline so subsequent
 * searches (any mode, any query) never open the book file, unzip it, or parse
 * section DOMs. The DB travels and dies with the book directory.
 *
 * Bump SEARCH_INDEX_VERSION whenever text extraction or folding changes so
 * stale caches rebuild on the next search.
 */
export const SEARCH_INDEX_VERSION = 1;

// Maximal folding (caseless + diacriticless) with the default locale: any
// occurrence under any stricter search config folds into an occurrence in
// this form, so a LIKE over the folded needle is a superset prefilter for
// contains/whole-words. The production matcher on the original text remains
// the final arbiter of matches and offsets.
const FOLD_OPTIONS = { matchCase: false, matchDiacritics: false };

type IndexAppService = Pick<AppService, 'openDatabase'>;

export interface SearchIndexMeta {
  updatedAt: number;
  version: number;
  totalSections: number;
  complete: boolean;
  // Hash of the TOC the node tree was built from. The TOC can change without
  // the book file changing (nav.json enrichment via hydrateBookNav, future
  // manual TOC edits), so node freshness is tracked separately from
  // (updatedAt, version).
  navHash: string;
}

export interface SearchIndexSection {
  idx: number;
  label: string;
  text: string;
}

interface MetaRow extends DatabaseRow {
  updated_at: number;
  version: number;
  total_sections: number;
  complete: number;
  nav_hash: string;
}

interface SectionRow extends DatabaseRow {
  idx: number;
  label: string;
  text: string;
}

export const openLibrarySearchDb = (
  appService: IndexAppService,
  book: Book,
): Promise<DatabaseService> =>
  appService.openDatabase('library-search', `${book.hash}/search.db`, 'Books');

export const readSearchIndexMeta = async (db: DatabaseService): Promise<SearchIndexMeta | null> => {
  const rows = await db.select<MetaRow>(
    'SELECT updated_at, version, total_sections, complete, nav_hash FROM search_meta WHERE id = 1',
  );
  const row = rows[0];
  if (!row) return null;
  return {
    updatedAt: row.updated_at,
    version: row.version,
    totalSections: row.total_sections,
    complete: row.complete === 1,
    navHash: row.nav_hash,
  };
};

export const isSearchIndexFresh = (meta: SearchIndexMeta | null, book: Book): boolean =>
  !!meta &&
  meta.complete &&
  meta.version === SEARCH_INDEX_VERSION &&
  meta.updatedAt === book.updatedAt;

export const beginSearchIndex = async (
  db: DatabaseService,
  book: Book,
  totalSections: number,
  navHash: string,
): Promise<void> => {
  await db.execute('DELETE FROM search_sections');
  await db.execute('DELETE FROM search_nodes');
  await db.execute('DELETE FROM search_meta');
  await db.execute(
    'INSERT INTO search_meta (id, updated_at, version, total_sections, complete, nav_hash) VALUES (1, ?, ?, ?, 0, ?)',
    [book.updatedAt, SEARCH_INDEX_VERSION, totalSections, navHash],
  );
};

// DELETE+INSERT rather than UPDATE: Tantivy-era wasm builds have a known
// UPDATE regression (see reedy migration notes), and rebuilds always replace.
export const writeSearchIndexSection = async (
  db: DatabaseService,
  idx: number,
  label: string,
  text: string,
): Promise<void> => {
  const folded = foldValue(text, FOLD_OPTIONS);
  await db.execute('DELETE FROM search_sections WHERE idx = ?', [idx]);
  await db.execute('INSERT INTO search_sections (idx, label, text, folded) VALUES (?, ?, ?, ?)', [
    idx,
    label,
    text,
    folded === text ? null : folded,
  ]);
};

// Turso is WAL-only (PRAGMA journal_mode = DELETE is ignored) and implements
// no auto-checkpoint (see statisticsDb), so without an explicit checkpoint
// every indexed byte stays in search.db-wal and the main file never grows
// past its 4 KB header. Fold the WAL after the build burst so the data lives
// in search.db, which file-level copy or sync of the book directory sees.
export const checkpointSearchIndex = async (db: DatabaseService): Promise<void> => {
  await db.execute('PRAGMA wal_checkpoint(TRUNCATE)').then(
    () => {},
    () => {},
  );
};

export const completeSearchIndex = async (db: DatabaseService): Promise<void> => {
  await db.execute('UPDATE search_meta SET complete = 1 WHERE id = 1');
  await checkpointSearchIndex(db);
};

export interface SearchIndexNode {
  nodeId: number;
  parentId: number | null;
  ord: number;
  depth: number;
  label: string;
  sectionStart: number;
  sectionEnd: number;
}

interface TocLikeItem {
  label: string;
  href: string;
  subitems?: TocLikeItem[];
}

// FNV-1a over the structural TOC content (labels, hrefs, nesting). Stable
// across runs; used to detect TOC changes that leave the book file untouched.
export const hashSearchToc = (toc: TocLikeItem[] | undefined): string => {
  let hash = 0x811c9dc5;
  const mix = (value: string) => {
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  const walk = (items: TocLikeItem[]) => {
    for (const item of items) {
      mix(item.label ?? '');
      mix('\u0001');
      mix(item.href ?? '');
      mix('\u0002');
      if (item.subitems?.length) {
        mix('[');
        walk(item.subitems);
        mix(']');
      }
    }
  };
  walk(toc ?? []);
  return hash.toString(16);
};

/**
 * Flatten a book TOC into pre-order node rows with section-level spans: a
 * node spans from its own resolved section to just before the next node at
 * the same or shallower depth. Unresolvable hrefs inherit the preceding
 * node's start so the tree stays contiguous.
 */
export const buildSearchIndexNodes = (
  toc: TocLikeItem[] | undefined,
  resolveSection: (href: string) => number | undefined,
  totalSections: number,
): SearchIndexNode[] => {
  if (!toc?.length || totalSections <= 0) return [];
  const nodes: SearchIndexNode[] = [];
  const walk = (items: TocLikeItem[], parentId: number | null, depth: number) => {
    for (const [ord, item] of items.entries()) {
      const nodeId = nodes.length;
      const resolved = resolveSection(item.href);
      const previousStart = nodes.at(-1)?.sectionStart ?? 0;
      const sectionStart = Math.min(
        Math.max(resolved ?? previousStart, previousStart),
        totalSections - 1,
      );
      nodes.push({
        nodeId,
        parentId,
        ord,
        depth,
        label: item.label ?? '',
        sectionStart,
        sectionEnd: totalSections - 1,
      });
      if (item.subitems?.length) walk(item.subitems, nodeId, depth + 1);
    }
  };
  walk(toc, null, 0);
  for (const [index, node] of nodes.entries()) {
    for (let next = index + 1; next < nodes.length; next++) {
      if (nodes[next]!.depth <= node.depth) {
        node.sectionEnd = Math.max(node.sectionStart, nodes[next]!.sectionStart - 1);
        break;
      }
    }
  }
  return nodes;
};

export const writeSearchIndexNodes = async (
  db: DatabaseService,
  nodes: SearchIndexNode[],
): Promise<void> => {
  await db.execute('DELETE FROM search_nodes');
  for (const node of nodes) {
    await db.execute(
      'INSERT INTO search_nodes (node_id, parent_id, ord, depth, label, section_start, section_end) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        node.nodeId,
        node.parentId,
        node.ord,
        node.depth,
        node.label,
        node.sectionStart,
        node.sectionEnd,
      ],
    );
  }
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const loadSearchIndexSections = (db: DatabaseService): Promise<SearchIndexSection[]> =>
  db.select<SectionRow>('SELECT idx, label, text FROM search_sections ORDER BY idx');

/**
 * Superset prefilter for contains/whole-words: sections whose folded text
 * contains the folded needle. Sections skipped here cannot match under any
 * config; sections returned still go through the exact matcher.
 */
export const loadSearchIndexCandidates = (
  db: DatabaseService,
  query: string,
): Promise<SearchIndexSection[]> => {
  const folded = foldValue(query, FOLD_OPTIONS);
  if (!folded) return loadSearchIndexSections(db);
  return db.select<SectionRow>(
    "SELECT idx, label, text FROM search_sections WHERE COALESCE(folded, text) LIKE ? ESCAPE '\\' ORDER BY idx",
    [`%${escapeLike(folded)}%`],
  );
};
