"use client";

import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useRouter } from "next/navigation";
import { useEnv } from "@/context/EnvContext";
import { useAuth } from "@/context/AuthContext";
import { isTauriAppPlatform } from "@/services/environment";
import { ingestFile } from "@/services/ingestService";
import {
  createLibrarySearchSession,
  resolveSearchResultCfis,
  searchLibraryBooks,
  type LibrarySearchSession,
} from "@/services/librarySearchService";
import { useBookDataStore } from "@/store/bookDataStore";
import { useLibraryStore } from "@/store/libraryStore";
import { getBookProgress } from "@/store/readerProgressStore";
import { useReaderStore } from "@/store/readerStore";
import { useSidebarStore } from "@/store/sidebarStore";
import type { Book } from "@/types/book";
import type { TOCItem } from "@/libs/document";
import type { AppService } from "@/types/system";
import type { FoliateView } from "@/types/view";
import { eventDispatcher } from "@/utils/event";
import { navigateToReader } from "@/utils/nav";
import {
  dispatch,
  type AgentBook,
  type AgentBookInfo,
  type AgentDeps,
  type AgentRange,
  type AgentTocItem,
  type AgentView,
} from "./protocol";

const AGENT_REQUEST = "agent-request";
const AGENT_RESPONSE = "agent-response";

interface HostLatest {
  appService: AppService | null;
  router: ReturnType<typeof useRouter> | null;
  isLoggedIn: boolean;
}

const latest: HostLatest = {
  appService: null,
  router: null,
  isLoggedIn: false,
};

// One listener for the whole desktop session. The reader shell and the app
// shell both retain it; strict-mode remounts must not stack a second one.
let subscribers = 0;
let stopListening: UnlistenFn | null = null;
let listenGeneration = 0;

function retain(start: () => Promise<UnlistenFn>): () => void {
  subscribers += 1;
  if (subscribers === 1 && !stopListening) {
    const generation = ++listenGeneration;
    void start().then((stop) => {
      if (generation !== listenGeneration || subscribers === 0) {
        stop();
        return;
      }
      stopListening = stop;
    });
  }
  return () => {
    subscribers -= 1;
    if (subscribers > 0) return;
    listenGeneration += 1;
    stopListening?.();
    stopListening = null;
  };
}

const readViewSelection = (view: FoliateView): AgentRange | null => {
  const contents = view.renderer?.getContents?.() ?? [];
  for (const content of contents) {
    const selection = content.doc?.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      continue;
    const range = selection.getRangeAt(0);
    const text = range.toString();
    if (!text) continue;
    const index = content.index ?? 0;
    const end = range.cloneRange();
    end.collapse(false);
    const startCfi = view.getCFI(index, range);
    const endCfi = view.getCFI(index, end);
    if (!startCfi) continue;
    return { text, startCfi, endCfi: endCfi || startCfi };
  }
  return null;
};

const adaptView = (view: FoliateView): AgentView => ({
  getRange() {
    try {
      return readViewSelection(view);
    } catch {
      return null;
    }
  },
  goTo(cfi) {
    return Promise.resolve()
      .then(() => view.goTo(cfi))
      .then(() => undefined);
  },
});

const placeholderBook = (hash: string, title: string): Book =>
  ({
    hash,
    title,
    format: "EPUB",
    author: "",
    createdAt: 0,
    updatedAt: 0,
  }) as Book;

const listBooks = (): AgentBook[] => {
  const { bookKeys, getView, getViewState } = useReaderStore.getState();
  const { getBookData } = useBookDataStore.getState();
  const { getBookByHash } = useLibraryStore.getState();
  return bookKeys.map((key) => {
    const hash = key.split("-")[0] ?? "";
    const stored = getBookData(key)?.book ?? getBookByHash(hash) ?? null;
    const view = getView(key);
    return {
      key,
      hash,
      title: stored?.title ?? "",
      book: stored ?? placeholderBook(hash, ""),
      view: view ? adaptView(view) : null,
      inited: !!view && !!getViewState(key)?.inited,
    };
  });
};

const flattenToc = (
  items: readonly TOCItem[] | undefined,
  depth = 0,
  out: AgentTocItem[] = [],
): AgentTocItem[] => {
  for (const item of items ?? []) {
    out.push({ label: item.label, cfi: item.cfi || null, depth });
    if (item.subitems?.length) flattenToc(item.subitems, depth + 1, out);
  }
  return out;
};

/** Text fields may be a plain string or a language map; take the first string. */
const firstText = (value: unknown): string | null => {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (typeof entry === "string" && entry) return entry;
    }
  }
  return null;
};

const bookInfoOf = (bookKey: string): AgentBookInfo | null => {
  const { getBookData } = useBookDataStore.getState();
  const data = getBookData(bookKey);
  if (!data) return null;
  const doc = data.bookDoc;
  const book = data.book;
  const metadata = doc?.metadata;
  const toc = doc?.toc ? flattenToc(doc.toc) : null;
  return {
    hash: book?.hash ?? bookKey.split("-")[0] ?? "",
    title: book?.title ?? firstText(metadata?.title) ?? "",
    author: book?.author ?? firstText(metadata?.author) ?? "",
    format: book?.format ?? "",
    language: firstText(metadata?.language),
    publisher: metadata?.publisher ?? null,
    identifier: metadata?.isbn ?? metadata?.identifier ?? null,
    filePath: book?.filePath ?? null,
    totalSections: doc?.sections?.length ?? 0,
    toc: toc && toc.length > 0 ? toc : null,
  };
};

const focusedKey = (): string | null => {
  const keys = useReaderStore.getState().bookKeys;
  const focused = useSidebarStore.getState().sideBarBookKey;
  if (focused && keys.includes(focused)) return focused;
  return keys[0] ?? null;
};

async function openAbsolutePath(
  path: string,
): Promise<{ hash: string; title: string } | null> {
  const appService = latest.appService;
  const router = latest.router;
  if (!appService || !router) return null;

  const settings = await appService.loadSettings();
  const {
    library: stored,
    libraryLoaded,
    setLibrary,
  } = useLibraryStore.getState();
  const library = libraryLoaded ? stored : await appService.loadLibraryBooks();
  const book = await ingestFile(
    {
      file: path,
      books: library,
      transient: appService.isMobile ? false : !settings.autoImportBooksOnOpen,
      forceUpload: !!appService.isMobile && latest.isLoggedIn,
    },
    { appService, settings, isLoggedIn: latest.isLoggedIn },
  );
  if (!book) return null;
  setLibrary(library);
  try {
    await appService.saveLibraryBooks(library);
  } catch {
    // The reader opens from the in-memory shelf. A failed write should not
    // hide a book that was just imported.
  }

  if (window.location.pathname.startsWith("/reader")) {
    await eventDispatcher.dispatch("open-book-in-reader", {
      bookHash: book.hash,
    });
  } else {
    navigateToReader(router, [book.hash]);
  }
  return { hash: book.hash, title: book.title };
}

const makeDeps = (): AgentDeps | null => {
  const appService = latest.appService;
  if (!appService) return null;
  return {
    books: listBooks,
    focusedKey,
    progress(bookKey) {
      const progress = getBookProgress(bookKey);
      if (!progress) return null;
      return {
        cfi: progress.location ?? null,
        sectionIndex: progress.section?.current ?? 0,
        chapterTitle: progress.sectionLabel ?? null,
        pageNumber: progress.pageinfo?.current ?? 0,
      };
    },
    bookInfo: bookInfoOf,
    async stat(path) {
      try {
        const info = await appService.stats(path, "None");
        return { exists: true, isFile: info.isFile && !info.isDirectory };
      } catch {
        return { exists: false, isFile: false };
      }
    },
    openAbsolute: openAbsolutePath,
    appService,
    createLibrarySearchSession,
    searchLibraryBooks,
    resolveSearchResultCfis: (session, book, locators) =>
      resolveSearchResultCfis(session as LibrarySearchSession, book, locators),
  };
};

async function onAgentRequest(payload: unknown): Promise<void> {
  const deps = makeDeps();
  const id =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { id?: unknown }).id === "string"
      ? (payload as { id: string }).id
      : undefined;
  const response = deps
    ? await dispatch(payload, deps).catch(() => ({
        ok: false as const,
        error: "bad-request",
        id,
      }))
    : { ok: false as const, error: "bad-request", id };
  await emit(AGENT_RESPONSE, response);
}

/**
 * Desktop listener for readest-cli. Call once from the app shell (so `open`
 * works before a book is on screen) and from the reader shell (so `getView`
 * is the live reader store while a book is open). A module refcount keeps a
 * single `agent-request` listener.
 */
export function useAgentBridgeHost(): void {
  const { appService } = useEnv();
  const router = useRouter();
  const { user } = useAuth();

  latest.appService = appService ?? null;
  latest.router = router;
  latest.isLoggedIn = !!user;

  const desktop = !!appService?.isDesktopApp && isTauriAppPlatform();
  useEffect(() => {
    if (!desktop) return;
    return retain(() =>
      listen(AGENT_REQUEST, (event) => {
        void onAgentRequest(event.payload);
      }),
    );
  }, [desktop]);
}

export function AgentBridgeHost() {
  useAgentBridgeHost();
  return null;
}
