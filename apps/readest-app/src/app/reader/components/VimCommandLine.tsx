import React, { useEffect, useRef } from 'react';
import * as CFI from 'foliate-js/epubcfi.js';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useVimFindStore } from '@/store/vimFindStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookSearchConfig } from '@/types/book';
import { Insets } from '@/types/misc';
import {
  createLibrarySearchSession,
  LibrarySearchSession,
  resolveSearchResultCfis,
  searchLibraryBooks,
} from '@/services/librarySearchService';

interface VimCommandLineProps {
  bookKey: string;
  gridInsets: Insets;
}

// The command line of vim-style find (#7281): `/` opens it to type a term,
// Enter searches the whole book and selects the first match at or after the
// current page, and it then shows the term and match count until Esc. It keeps
// its own search, so the sidebar search and its highlights are left alone.
const VimCommandLine: React.FC<VimCommandLineProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  // Per-field selectors: this is mounted in every book cell, so a whole-store
  // subscription would re-render it on every page turn (see BooksGrid).
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getConfig = useBookDataStore((s) => s.getConfig);
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const hoveredBookKey = useReaderStore((s) => s.hoveredBookKey);
  const {
    bookKey: findBookKey,
    typing,
    term,
    matches,
    index,
    searching,
    error,
  } = useVimFindStore();
  const sessionRef = useRef<LibrarySearchSession | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      void sessionRef.current?.close();
      const { bookKey: activeKey, closeFind } = useVimFindStore.getState();
      if (activeKey === bookKey) closeFind();
    },
    [bookKey],
  );

  const runFind = async (query: string) => {
    const book = getBookData(bookKey)?.book;
    const view = getView(bookKey);
    if (!query.trim() || !book || !appService || !view) {
      useVimFindStore.getState().closeFind();
      return;
    }
    useVimFindStore.setState({ typing: false, term: query, searching: true });
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const session = (sessionRef.current ??= createLibrarySearchSession(appService));
    const start = getProgress(bookKey)?.location;
    const isCurrent = () => {
      const state = useVimFindStore.getState();
      return !controller.signal.aborted && state.bookKey === bookKey && state.term === query;
    };
    const found: string[] = [];
    let selected = -1;
    const select = (i: number) => {
      selected = i;
      useVimFindStore.setState({ index: i });
      view.select(found[i]!);
    };
    try {
      for await (const event of searchLibraryBooks(appService, [book], query, {
        config: getConfig(bookKey)?.searchConfig as BookSearchConfig,
        signal: controller.signal,
        session,
        maxResultsPerBook: Infinity,
      })) {
        if (!isCurrent()) return;
        if (event.type === 'result') {
          const locators = event.result.subitems.map((match) => match.locator);
          const resolved = await resolveSearchResultCfis(session, book, locators);
          if (!isCurrent()) return;
          resolved.forEach((entry) => entry && found.push(entry.cfi));
          useVimFindStore.setState({ matches: [...found] });
          if (selected < 0) {
            const next = start ? found.findIndex((cfi) => CFI.compare(cfi, start) >= 0) : 0;
            if (next >= 0) select(next);
          }
        } else if (event.type === 'book-error' || event.type === 'book-skipped') {
          const code = event.type === 'book-error' ? event.code : undefined;
          const message =
            code === 'INVALID_REGEX'
              ? _('Invalid regular expression')
              : code === 'NEARBY_NEEDS_TWO_WORDS'
                ? _('Enter at least two words')
                : _('Search failed');
          useVimFindStore.setState({ searching: false, error: message });
          return;
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('vim find failed:', err);
      useVimFindStore.setState({ searching: false, error: _('Search failed') });
      return;
    }
    if (!isCurrent()) return;
    // Nothing at or after the page: wrap to the first match, as vim does.
    if (selected < 0 && found.length > 0) select(0);
    useVimFindStore.setState({
      searching: false,
      error: found.length ? null : _('Pattern not found: {{term}}', { term: query }),
    });
  };

  if (findBookKey !== bookKey) return null;

  // Sit above the footer bar (h-[52px]) while the reader chrome is shown, so
  // the line that says the search is live never disappears behind it.
  const footerOffset = hoveredBookKey === bookKey ? 52 : 0;

  const count =
    index >= 0 ? `[${index + 1}/${matches.length}${searching ? '+' : ''}]` : searching ? '…' : '';

  return (
    <div
      className='vim-command-line eink-bordered border-base-300 bg-base-100 text-base-content absolute z-30 flex h-8 items-center gap-1 border-t px-3 font-mono text-sm'
      style={{
        left: gridInsets.left,
        right: gridInsets.right,
        bottom: gridInsets.bottom * 0.33 + footerOffset,
      }}
    >
      <span>/</span>
      {typing ? (
        <input
          autoFocus
          aria-label={_('Find on Page')}
          className='min-w-0 flex-1 bg-transparent outline-none'
          spellCheck={false}
          onBlur={() => {
            // Enter has already turned typing off; only a real blur cancels.
            if (useVimFindStore.getState().typing) useVimFindStore.getState().closeFind();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runFind(e.currentTarget.value);
            else if (e.key === 'Escape') useVimFindStore.getState().closeFind();
          }}
        />
      ) : (
        <span className='min-w-0 flex-1 truncate'>{term}</span>
      )}
      {error ? <span className='text-error truncate'>{error}</span> : <span>{count}</span>}
    </div>
  );
};

export default VimCommandLine;
