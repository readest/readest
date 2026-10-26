import type { Book, SearchExcerpt, SearchResultLocator } from "@/types/book";
import type {
  LibrarySearchEvent,
  LibrarySearchOptions,
} from "@/services/librarySearchService";
import type { AppService } from "@/types/system";
import { isCJKStr } from "@/utils/lang";
import { DEFAULT_NEARBY_WORDS } from "@/utils/searchConfig";

const SEARCH_MODES = [
  "contains",
  "whole-words",
  "regex",
  "nearby-words",
] as const;
const SEARCH_SCOPES = ["book", "section"] as const;
const COMMANDS = [
  "status",
  "open",
  "context",
  "selection",
  "search",
  "goto",
  "info",
] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_CHARS = 500;

type SearchMode = (typeof SEARCH_MODES)[number];
type SearchScope = (typeof SEARCH_SCOPES)[number];
type Command = (typeof COMMANDS)[number];

export interface AgentRange {
  text: string;
  startCfi: string;
  endCfi: string;
}

/** The slice of a live reader view the bridge needs. No I/O of its own. */
export interface AgentView {
  getRange(): AgentRange | null;
  goTo(cfi: string): Promise<void> | void;
}

export interface AgentBook {
  key: string;
  hash: string;
  title: string;
  book: Book;
  view: AgentView | null;
  /** True after `getView` exists and the view has finished `init`. */
  inited: boolean;
}

export interface AgentProgress {
  cfi: string | null;
  sectionIndex: number;
  chapterTitle: string | null;
  pageNumber: number;
}

export interface AgentPathStat {
  exists: boolean;
  isFile: boolean;
}

/** One TOC entry, flattened with its depth so a client can print a tree. */
export interface AgentTocItem {
  label: string;
  cfi: string | null;
  depth: number;
}

/** Document facts about the open book that are not a reading position. */
export interface AgentBookInfo {
  hash: string;
  title: string;
  author: string;
  format: string;
  language: string | null;
  publisher: string | null;
  identifier: string | null;
  filePath: string | null;
  /** Number of spine sections; 0 when the document has not been parsed. */
  totalSections: number;
  /** `null` when the doc is unparsed or exposes no TOC. */
  toc: AgentTocItem[] | null;
}

export interface AgentSearchSession {
  close?: () => Promise<void> | void;
}

export interface AgentDeps {
  books(): AgentBook[];
  focusedKey(): string | null;
  progress(bookKey: string): AgentProgress | null;
  /** Document metadata for one open book; `null` when it is not open. */
  bookInfo(bookKey: string): AgentBookInfo | null;
  stat(path: string): Promise<AgentPathStat>;
  openAbsolute(path: string): Promise<{ hash: string; title: string } | null>;
  appService: AppService;
  createLibrarySearchSession(appService: AppService): AgentSearchSession;
  searchLibraryBooks(
    appService: AppService,
    books: Book[],
    query: string,
    options: LibrarySearchOptions,
  ): AsyncIterable<LibrarySearchEvent>;
  resolveSearchResultCfis(
    session: AgentSearchSession,
    book: Book,
    locators: SearchResultLocator[],
  ): Promise<Array<{ cfi: string; cfis?: string[] } | null>>;
}

export interface AgentHit {
  cfi: string;
  cfis: string[] | null;
  sectionLabel: string;
  excerpt: SearchExcerpt;
}

export interface AgentResponse {
  ok: boolean;
  id?: string;
  error?: string;
  running?: boolean;
  books?: Array<{ hash: string; title: string; viewReady: boolean }>;
  hash?: string;
  title?: string;
  viewReady?: boolean;
  cfi?: string | null;
  sectionIndex?: number;
  chapterTitle?: string | null;
  pageNumber?: number;
  selection?: AgentRange | null;
  truncated?: boolean;
  hits?: AgentHit[];
  navigated?: boolean;
  reason?: string;
  author?: string;
  format?: string;
  language?: string | null;
  publisher?: string | null;
  identifier?: string | null;
  filePath?: string | null;
  totalSections?: number;
  toc?: AgentTocItem[] | null;
}

const fail = (id: string | undefined, error: string): AgentResponse =>
  id ? { ok: false, error, id } : { ok: false, error };

const field = (request: Record<string, unknown>, key: string): unknown =>
  request[key];

const stringField = (
  request: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = field(request, key);
  return typeof value === "string" ? value : undefined;
};

/**
 * Absolute filesystem path. URLs (`file://` included) and bare names are
 * `not-absolute` and never reach `stat` or `openAbsolute`.
 */
export const classifyOpenPath = (path: string): "ok" | "not-absolute" => {
  if (!path) return "not-absolute";
  // Drive letters look like a one-character URI scheme (`C:`), so absolute
  // filesystem forms are recognized before the scheme check.
  if (
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("\\\\") ||
    path.startsWith("/")
  ) {
    return "ok";
  }
  return "not-absolute";
};

const viewReady = (book: AgentBook): boolean =>
  book.view != null && book.inited;

const selectionOf = (view: AgentView): AgentRange | null => {
  const range = view.getRange();
  if (!range || range.text.length === 0) return null;
  return range;
};

const resolveTarget = (
  deps: AgentDeps,
  hash: string | undefined,
): AgentBook | "missing" | "none" => {
  const books = deps.books();
  const focused = deps.focusedKey();
  if (hash) {
    const matches = books.filter((book) => book.hash === hash);
    if (matches.length === 0) return "missing";
    return matches.find((book) => book.key === focused) ?? matches[0]!;
  }
  if (focused) {
    const match = books.find((book) => book.key === focused);
    if (match) return match;
  }
  return books[0] ?? "none";
};

const searchError = (code: string | undefined): string => {
  if (code === "INVALID_REGEX") return "invalid-regex";
  if (code === "NEARBY_NEEDS_TWO_WORDS") return "nearby-needs-two-words";
  if (code === "FUZZY_QUERY_TOO_LONG") return "query-too-long";
  return "search-failed";
};

const clampLimit = (value: unknown): number | "bad" => {
  if (value == null) return DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    return "bad";
  return Math.min(value, MAX_LIMIT);
};

/**
 * Run one agent command. Performs no I/O itself: the filesystem, the reader
 * view, and library search all come in through `deps`.
 */
export async function dispatch(
  request: unknown,
  deps: AgentDeps,
): Promise<AgentResponse> {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return fail(undefined, "bad-request");
  }
  const body = request as Record<string, unknown>;
  const id = stringField(body, "id");
  const cmd = stringField(body, "cmd");
  if (!id || !cmd || !(COMMANDS as readonly string[]).includes(cmd)) {
    return fail(id, "bad-request");
  }
  const command = cmd as Command;
  const bookHash = stringField(body, "book");
  if (field(body, "book") != null && !bookHash) return fail(id, "bad-request");

  if (command === "open") return openBook(id, body, deps);
  if (command === "status") return status(id, deps, bookHash);

  const target = resolveTarget(deps, bookHash);
  if (target === "missing" || target === "none")
    return fail(id, "book-not-open");

  // `info` describes the document, which is parsed before (and independently
  // of) a live reader view -- asking for metadata must not require a view.
  if (command === "info") return bookInfo(id, target, deps);

  if (!viewReady(target) || !target.view) return fail(id, "view-not-ready");

  switch (command) {
    case "context":
      return context(id, target, deps);
    case "selection":
      return { ok: true, id, selection: selectionOf(target.view) };
    case "search":
      return search(id, body, target, deps);
    case "goto":
      return goTo(id, body, target.view);
    default:
      return fail(id, "bad-request");
  }
}

function status(
  id: string,
  deps: AgentDeps,
  bookHash: string | undefined,
): AgentResponse {
  if (bookHash && resolveTarget(deps, bookHash) === "missing") {
    return fail(id, "book-not-open");
  }
  return {
    ok: true,
    id,
    running: true,
    books: deps.books().map((book) => ({
      hash: book.hash,
      title: book.title,
      viewReady: viewReady(book),
    })),
  };
}

async function openBook(
  id: string,
  body: Record<string, unknown>,
  deps: AgentDeps,
): Promise<AgentResponse> {
  const path = stringField(body, "path");
  if (path == null) return fail(id, "bad-request");
  if (classifyOpenPath(path) !== "ok") return fail(id, "not-absolute");
  const stat = await deps.stat(path);
  if (!stat.exists) return fail(id, "not-found");
  if (!stat.isFile) return fail(id, "not-a-file");
  try {
    const opened = await deps.openAbsolute(path);
    if (!opened) return fail(id, "not-found");
    const live = deps.books().find((book) => book.hash === opened.hash);
    return {
      ok: true,
      id,
      hash: opened.hash,
      title: opened.title,
      viewReady: live ? viewReady(live) : false,
    };
  } catch {
    return fail(id, "not-found");
  }
}

function bookInfo(
  id: string,
  target: AgentBook,
  deps: AgentDeps,
): AgentResponse {
  const info = deps.bookInfo(target.key);
  if (!info) return fail(id, "book-not-open");
  return {
    ok: true,
    id,
    hash: info.hash,
    title: info.title,
    author: info.author,
    format: info.format,
    language: info.language,
    publisher: info.publisher,
    identifier: info.identifier,
    filePath: info.filePath,
    totalSections: info.totalSections,
    toc: info.toc,
  };
}

function context(
  id: string,
  target: AgentBook,
  deps: AgentDeps,
): AgentResponse {
  const progress = deps.progress(target.key);
  return {
    ok: true,
    id,
    cfi: progress?.cfi ?? null,
    sectionIndex: progress?.sectionIndex ?? 0,
    chapterTitle: progress?.chapterTitle ?? null,
    pageNumber: progress?.pageNumber ?? 0,
    selection: target.view ? selectionOf(target.view) : null,
  };
}

async function goTo(
  id: string,
  body: Record<string, unknown>,
  view: AgentView,
): Promise<AgentResponse> {
  const cfi = stringField(body, "cfi");
  if (!cfi || cfi.trim().length === 0) return fail(id, "bad-request");
  try {
    await view.goTo(cfi);
    return { ok: true, id, navigated: true };
  } catch {
    return { ok: true, id, navigated: false, reason: "unresolved" };
  }
}

async function search(
  id: string,
  body: Record<string, unknown>,
  target: AgentBook,
  deps: AgentDeps,
): Promise<AgentResponse> {
  const query = stringField(body, "query");
  if (query == null) return fail(id, "bad-request");
  const chars = Array.from(query).length;
  if (chars > MAX_QUERY_CHARS) return fail(id, "query-too-long");
  const cjkCharacter = chars === 1 && isCJKStr(query);
  if (chars < 2 && !cjkCharacter) return fail(id, "query-too-short");

  const mode = stringField(body, "mode") ?? "contains";
  const scope = stringField(body, "scope") ?? "book";
  if (!(SEARCH_MODES as readonly string[]).includes(mode))
    return fail(id, "bad-request");
  if (!(SEARCH_SCOPES as readonly string[]).includes(scope))
    return fail(id, "bad-request");
  if (
    field(body, "matchCase") != null &&
    typeof field(body, "matchCase") !== "boolean"
  ) {
    return fail(id, "bad-request");
  }
  if (
    field(body, "matchDiacritics") != null &&
    typeof field(body, "matchDiacritics") !== "boolean"
  ) {
    return fail(id, "bad-request");
  }
  const limit = clampLimit(field(body, "limit"));
  if (limit === "bad") return fail(id, "bad-request");
  const nearbyWords = field(body, "nearbyWords");
  if (
    nearbyWords != null &&
    (typeof nearbyWords !== "number" ||
      !Number.isInteger(nearbyWords) ||
      nearbyWords < 1)
  ) {
    return fail(id, "bad-request");
  }

  const progress = deps.progress(target.key);
  const sectionIndex =
    scope === "section" && progress ? progress.sectionIndex : undefined;
  const session = deps.createLibrarySearchSession(deps.appService);
  try {
    const options: LibrarySearchOptions = {
      config: {
        mode: mode as SearchMode,
        scope: scope as SearchScope,
        matchCase: field(body, "matchCase") === true,
        matchDiacritics: field(body, "matchDiacritics") === true,
        nearbyWords:
          typeof nearbyWords === "number" ? nearbyWords : DEFAULT_NEARBY_WORDS,
      },
      session: session as LibrarySearchOptions["session"],
      maxResultsPerBook: Infinity,
    };
    if (sectionIndex != null) options.sectionIndex = sectionIndex;

    const hits: AgentHit[] = [];
    let reportedTruncated = false;
    for await (const event of deps.searchLibraryBooks(
      deps.appService,
      [target.book],
      query,
      options,
    )) {
      if (event.type === "book-error") return fail(id, searchError(event.code));
      if (event.type === "book-skipped") return fail(id, "search-failed");
      if (event.type === "book-completed" || event.type === "completed") {
        if (event.truncated) reportedTruncated = true;
      }
      if (event.type !== "result") continue;
      const locators = event.result.subitems.map((match) => match.locator);
      const resolved = await deps.resolveSearchResultCfis(
        session,
        target.book,
        locators,
      );
      resolved.forEach((entry, index) => {
        if (!entry) return;
        const match = event.result.subitems[index];
        if (!match) return;
        hits.push({
          cfi: entry.cfi,
          cfis: entry.cfis && entry.cfis.length > 1 ? entry.cfis : null,
          sectionLabel: event.result.label,
          excerpt: match.excerpt,
        });
      });
    }
    return {
      ok: true,
      id,
      truncated: reportedTruncated || hits.length > limit,
      hits: hits.slice(0, limit),
    };
  } catch {
    return fail(id, "search-failed");
  } finally {
    await session.close?.();
  }
}
