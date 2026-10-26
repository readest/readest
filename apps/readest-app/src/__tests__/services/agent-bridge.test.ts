import { describe, expect, it, vi } from "vitest";

import {
  dispatch,
  type AgentBook,
  type AgentBookInfo,
  type AgentDeps,
  type AgentProgress,
  type AgentRange,
  type AgentView,
} from "@/services/agentBridge/protocol";
import type { LibrarySearchEvent } from "@/services/librarySearchService";
import type { Book, SearchResultLocator } from "@/types/book";
import type { AppService } from "@/types/system";

const makeBook = (hash: string, title: string): Book =>
  ({
    hash,
    format: "EPUB",
    title,
    author: "Author",
    createdAt: 1,
    updatedAt: 1,
  }) as Book;

const progress = (overrides: Partial<AgentProgress> = {}): AgentProgress => ({
  cfi: "epubcfi(/6/14!/4/2/1:0)",
  sectionIndex: 3,
  chapterTitle: "第3章",
  pageNumber: 16,
  ...overrides,
});

const bookInfo = (overrides: Partial<AgentBookInfo> = {}): AgentBookInfo => ({
  hash: "hash",
  title: "《三体》中的物理学",
  author: "李淼",
  format: "EPUB",
  language: "zh",
  publisher: "湖南科学技术出版社",
  identifier: "9787571001483",
  filePath: "C:\\Books\\SanTiZhongDeWuLiXue.epub",
  totalSections: 12,
  toc: [
    { label: "第一章", cfi: "epubcfi(/6/2!/4/2)", depth: 0 },
    { label: "1.1 节", cfi: "epubcfi(/6/4!/4/2)", depth: 1 },
  ],
  ...overrides,
});

interface Harness {
  deps: AgentDeps;
  books: AgentBook[];
  goTo: ReturnType<typeof vi.fn>;
  searchLibraryBooks: ReturnType<typeof vi.fn>;
  resolveSearchResultCfis: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  openAbsolute: ReturnType<typeof vi.fn>;
  createLibrarySearchSession: ReturnType<typeof vi.fn>;
  bookInfo: ReturnType<typeof vi.fn>;
}

const harness = (setup?: (state: { books: AgentBook[] }) => void): Harness => {
  const books: AgentBook[] = [];
  setup?.({ books });
  const goTo = vi.fn(async () => undefined);
  const searchLibraryBooks = vi.fn(
    async function* (): AsyncGenerator<LibrarySearchEvent> {
      yield {
        type: "completed",
        searchedBooks: 0,
        skippedBooks: 0,
        erroredBooks: 0,
        matchCount: 0,
      };
    },
  );
  const resolveSearchResultCfis = vi.fn(
    async (_session: unknown, _book: Book, locators: SearchResultLocator[]) =>
      locators.map((locator) => ({ cfi: `cfi-${locator.start}` })),
  );
  const stat = vi.fn(async () => ({ exists: true, isFile: true }));
  const openAbsolute = vi.fn(async () => ({ hash: "opened", title: "Opened" }));
  const createLibrarySearchSession = vi.fn(() => ({ close: vi.fn() }));
  const bookInfoFn = vi.fn(() => bookInfo());
  const deps: AgentDeps = {
    books: () => books,
    focusedKey: () => books[0]?.key ?? null,
    progress: () => progress(),
    bookInfo: bookInfoFn,
    stat,
    openAbsolute,
    appService: {} as AppService,
    createLibrarySearchSession,
    searchLibraryBooks,
    resolveSearchResultCfis,
  };
  return {
    deps,
    books,
    goTo,
    searchLibraryBooks,
    resolveSearchResultCfis,
    stat,
    openAbsolute,
    createLibrarySearchSession,
    bookInfo: bookInfoFn,
  };
};

const openBook = (
  state: { books: AgentBook[] },
  view: AgentView | null,
  inited = !!view,
): AgentBook => {
  const book: AgentBook = {
    key: "hash-1",
    hash: "hash",
    title: "《三体》中的物理学",
    book: makeBook("hash", "《三体》中的物理学"),
    view,
    inited,
  };
  state.books.push(book);
  return book;
};

const readyView = (
  range: AgentRange | null,
  goTo?: AgentView["goTo"],
): AgentView => ({
  getRange: () => range,
  goTo: goTo ?? vi.fn(async () => undefined),
});

const run = (request: Record<string, unknown>, deps: AgentDeps) =>
  dispatch({ id: "1", ...request }, deps);

describe("agent bridge dispatch", () => {
  it("status with no books returns an empty list", async () => {
    const { deps } = harness();
    const response = await run({ cmd: "status" }, deps);
    expect(response).toMatchObject({ ok: true, running: true, books: [] });
  });

  it("status reports viewReady from the view", async () => {
    const state = harness((draft) => {
      openBook(draft, null, false);
    });
    const before = await run({ cmd: "status" }, state.deps);
    expect(before.books?.[0]).toMatchObject({ hash: "hash", viewReady: false });

    state.books[0]!.view = readyView(null);
    state.books[0]!.inited = true;
    const after = await run({ cmd: "status" }, state.deps);
    expect(after.books?.[0]?.viewReady).toBe(true);
  });

  it("context returns the reading position and a null selection", async () => {
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    const response = await run({ cmd: "context" }, deps);
    expect(response).toMatchObject({
      ok: true,
      cfi: "epubcfi(/6/14!/4/2/1:0)",
      sectionIndex: 3,
      chapterTitle: "第3章",
      pageNumber: 16,
      selection: null,
    });
  });

  it("context includes the selection when the view has a range", async () => {
    const range = { text: "黑暗森林", startCfi: "start", endCfi: "end" };
    const { deps } = harness((draft) => {
      openBook(draft, readyView(range));
    });
    const response = await run({ cmd: "context" }, deps);
    expect(response.selection).toEqual(range);
  });

  it("context and selection return view-not-ready when the view is missing", async () => {
    const { deps } = harness((draft) => {
      openBook(draft, null, false);
    });
    expect(await run({ cmd: "context" }, deps)).toMatchObject({
      ok: false,
      error: "view-not-ready",
    });
    expect(await run({ cmd: "selection" }, deps)).toMatchObject({
      ok: false,
      error: "view-not-ready",
    });
  });

  it("info returns document metadata and the flattened toc", async () => {
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    const response = await run({ cmd: "info" }, deps);
    expect(response).toMatchObject({
      ok: true,
      hash: "hash",
      title: "《三体》中的物理学",
      author: "李淼",
      format: "EPUB",
      language: "zh",
      publisher: "湖南科学技术出版社",
      identifier: "9787571001483",
      filePath: "C:\\Books\\SanTiZhongDeWuLiXue.epub",
      totalSections: 12,
    });
    expect(response.toc).toEqual([
      { label: "第一章", cfi: "epubcfi(/6/2!/4/2)", depth: 0 },
      { label: "1.1 节", cfi: "epubcfi(/6/4!/4/2)", depth: 1 },
    ]);
  });

  it("info works before the view is ready", async () => {
    // Metadata is parsed at open time; a still-loading view must not block it.
    const { deps } = harness((draft) => {
      openBook(draft, null, false);
    });
    expect(await run({ cmd: "info" }, deps)).toMatchObject({
      ok: true,
      title: "《三体》中的物理学",
    });
  });

  it("info reports book-not-open for a hash that is not open", async () => {
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    expect(await run({ cmd: "info", book: "missing" }, deps)).toMatchObject({
      ok: false,
      error: "book-not-open",
    });
  });

  it("info returns a null toc when the document exposes none", async () => {
    const { deps, bookInfo: bookInfoFn } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    bookInfoFn.mockReturnValueOnce(bookInfo({ toc: null, totalSections: 0 }));
    const response = await run({ cmd: "info" }, deps);
    expect(response).toMatchObject({ ok: true, toc: null, totalSections: 0 });
  });

  it("selection returns text and cfis", async () => {
    const range = { text: "黑暗森林", startCfi: "start", endCfi: "end" };
    const { deps } = harness((draft) => {
      openBook(draft, readyView(range));
    });
    expect(await run({ cmd: "selection" }, deps)).toMatchObject({
      ok: true,
      selection: range,
    });
  });

  it("selection returns null when the range is empty", async () => {
    const { deps } = harness((draft) => {
      openBook(
        draft,
        readyView({ text: "", startCfi: "start", endCfi: "end" }),
      );
    });
    expect(await run({ cmd: "selection" }, deps)).toMatchObject({
      ok: true,
      selection: null,
    });
  });

  it("search passes mode, scope, and flags through", async () => {
    const { deps, searchLibraryBooks } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    await run(
      {
        cmd: "search",
        query: "dark forest",
        mode: "regex",
        scope: "section",
        matchCase: true,
        matchDiacritics: true,
        nearbyWords: 7,
      },
      deps,
    );
    const options = searchLibraryBooks.mock.calls[0]?.[3];
    expect(options.config).toMatchObject({
      mode: "regex",
      scope: "section",
      matchCase: true,
      matchDiacritics: true,
      nearbyWords: 7,
    });
    expect(options.sectionIndex).toBe(3);
  });

  it("search resolves locators and returns cfi, excerpt, and section label", async () => {
    const { deps, resolveSearchResultCfis } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    deps.searchLibraryBooks = async function* () {
      yield {
        type: "result",
        book: makeBook("hash", "《三体》中的物理学"),
        result: {
          index: 3,
          label: "第3章",
          subitems: [
            {
              locator: { section: 3, start: 10, end: 14 },
              excerpt: { pre: "所谓", match: "黑暗森林", post: "法则" },
            },
          ],
        },
      };
    };
    const response = await run({ cmd: "search", query: "黑暗森林" }, deps);
    expect(resolveSearchResultCfis).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      ok: true,
      truncated: false,
      hits: [
        {
          cfi: "cfi-10",
          cfis: null,
          sectionLabel: "第3章",
          excerpt: { pre: "所谓", match: "黑暗森林", post: "法则" },
        },
      ],
    });
  });

  it("search sets cfis when a nearby-words match covers more than one span", async () => {
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    deps.searchLibraryBooks = async function* () {
      yield {
        type: "result",
        book: makeBook("hash", "Title"),
        result: {
          index: 1,
          label: "Chapter",
          subitems: [
            {
              locator: {
                section: 1,
                start: 0,
                end: 8,
                runs: [
                  { start: 0, end: 2 },
                  { start: 6, end: 8 },
                ],
              },
              excerpt: { pre: "", match: "dark forest", post: "" },
            },
          ],
        },
      };
    };
    deps.resolveSearchResultCfis = vi.fn(async () => [
      { cfi: "span", cfis: ["word-a", "word-b"] },
    ]);
    const response = await run(
      { cmd: "search", query: "dark forest", mode: "nearby-words" },
      deps,
    );
    expect(response.hits?.[0]?.cfis).toEqual(["word-a", "word-b"]);
  });

  it("search caps hits at the limit and treats a limit above 100 as 100", async () => {
    const withHits = (count: number) => {
      const state = harness((draft) => {
        openBook(draft, readyView(null));
      });
      state.deps.searchLibraryBooks = async function* () {
        yield {
          type: "result",
          book: makeBook("hash", "Title"),
          result: {
            index: 0,
            label: "Chapter",
            subitems: Array.from({ length: count }, (_, index) => ({
              locator: { section: 0, start: index, end: index + 1 },
              excerpt: { pre: "", match: String(index), post: "" },
            })),
          },
        };
      };
      return state.deps;
    };

    const capped = await run(
      { cmd: "search", query: "forest", limit: 5 },
      withHits(8),
    );
    expect(capped.hits).toHaveLength(5);
    expect(capped.truncated).toBe(true);

    const defaults = await run(
      { cmd: "search", query: "forest" },
      withHits(25),
    );
    expect(defaults.hits).toHaveLength(20);
    expect(defaults.truncated).toBe(true);

    const maximum = await run(
      { cmd: "search", query: "forest", limit: 150 },
      withHits(150),
    );
    expect(maximum.hits).toHaveLength(100);
    expect(maximum.truncated).toBe(true);
  });

  it("search rejects a one-character query unless it is CJK", async () => {
    const { deps, searchLibraryBooks } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    expect(await run({ cmd: "search", query: "a" }, deps)).toMatchObject({
      ok: false,
      error: "query-too-short",
    });
    expect(searchLibraryBooks).not.toHaveBeenCalled();

    const allowed = await run({ cmd: "search", query: "森" }, deps);
    expect(allowed.ok).toBe(true);
    expect(searchLibraryBooks).toHaveBeenCalledTimes(1);
  });

  it("search maps sidebar failure codes", async () => {
    const codes: Array<[string, string]> = [
      ["INVALID_REGEX", "invalid-regex"],
      ["NEARBY_NEEDS_TWO_WORDS", "nearby-needs-two-words"],
      ["FUZZY_QUERY_TOO_LONG", "query-too-long"],
    ];
    for (const [code, error] of codes) {
      const { deps } = harness((draft) => {
        openBook(draft, readyView(null));
      });
      deps.searchLibraryBooks = async function* () {
        yield {
          type: "book-error",
          book: makeBook("hash", "Title"),
          error: code,
          code,
        };
      };
      expect(
        await run({ cmd: "search", query: "dark forest" }, deps),
      ).toMatchObject({
        ok: false,
        error,
      });
    }
  });

  it("search with section scope and no progress searches the whole book", async () => {
    const { deps, searchLibraryBooks } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    deps.progress = () => null;
    await run({ cmd: "search", query: "dark forest", scope: "section" }, deps);
    expect(searchLibraryBooks.mock.calls[0]?.[3].sectionIndex).toBeUndefined();
  });

  it("goto calls goTo and reports success", async () => {
    const goTo = vi.fn(async () => undefined);
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null, goTo));
    });
    const response = await run({ cmd: "goto", cfi: "epubcfi(/6/2)" }, deps);
    expect(goTo).toHaveBeenCalledWith("epubcfi(/6/2)");
    expect(response).toMatchObject({ ok: true, navigated: true });
  });

  it("goto reports unresolved when goTo rejects", async () => {
    const goTo = vi.fn(async () => {
      throw new Error("missing");
    });
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null, goTo));
    });
    expect(
      await run({ cmd: "goto", cfi: "epubcfi(/6/2)" }, deps),
    ).toMatchObject({
      ok: true,
      navigated: false,
      reason: "unresolved",
    });
  });

  it("goto with an empty cfi is a bad request and does not call goTo", async () => {
    const goTo = vi.fn(async () => undefined);
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null, goTo));
    });
    expect(await run({ cmd: "goto", cfi: "" }, deps)).toMatchObject({
      ok: false,
      error: "bad-request",
    });
    expect(goTo).not.toHaveBeenCalled();
  });

  it("open rejects a relative path, a file url, a missing path, and a directory", async () => {
    const { deps, stat, openAbsolute } = harness();
    const rejected = async (
      path: string,
      error: string,
      statResult?: { exists: boolean; isFile: boolean },
    ) => {
      if (statResult) stat.mockResolvedValueOnce(statResult);
      const response = await run({ cmd: "open", path }, deps);
      expect(response).toMatchObject({ ok: false, error });
    };
    await rejected("book.epub", "not-absolute");
    await rejected("file:///C:/book.epub", "not-absolute");
    await rejected("C:/Books/missing.epub", "not-found", {
      exists: false,
      isFile: false,
    });
    await rejected("C:/Books", "not-a-file", { exists: true, isFile: false });
    expect(openAbsolute).not.toHaveBeenCalled();
  });

  it("open calls the helper once for an absolute file", async () => {
    const { deps, openAbsolute } = harness();
    openAbsolute.mockResolvedValueOnce({
      hash: "abc",
      title: "《三体》中的物理学",
    });
    const response = await run(
      { cmd: "open", path: "C:/Books/book.epub" },
      deps,
    );
    expect(openAbsolute).toHaveBeenCalledTimes(1);
    expect(openAbsolute).toHaveBeenCalledWith("C:/Books/book.epub");
    expect(response).toMatchObject({
      ok: true,
      hash: "abc",
      title: "《三体》中的物理学",
      viewReady: false,
    });
  });

  it("unknown commands are bad-request and a closed hash is book-not-open", async () => {
    const { deps } = harness((draft) => {
      openBook(draft, readyView(null));
    });
    expect(await run({ cmd: "highlight" }, deps)).toMatchObject({
      ok: false,
      error: "bad-request",
    });
    expect(await run({ cmd: "context", book: "missing" }, deps)).toMatchObject({
      ok: false,
      error: "book-not-open",
    });
  });
});
