'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MdMenuBook } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { downloadNovel, fetchNovelToc, isNovelImportCancelled } from '@/services/novel/novelImport';
import { openWebBrowser } from '@/services/webBrowser/webBrowser';
import { getWebBrowserOptions } from '@/services/webBrowser/webBrowserOptions';
import type { WebBrowserPage } from '@/services/webBrowser/webBrowser';
import type { NovelToc } from '@/services/novel/chapterList';

interface ImportNovelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Hand the finished `.epub` to the normal library import path. */
  onImport: (file: File) => Promise<void>;
}

type Phase = 'url' | 'preview' | 'downloading';

/**
 * Modal for the Library import-menu's "From Web Novel" entry. Three phases:
 * paste the TOC URL, confirm the detected chapter list (heuristics can
 * misfire — never start a hundreds-of-requests download unconfirmed), then
 * a cancellable download progress bar. Tauri-only, like "From Web Browser" — a
 * web build can't fetch cross-origin pages.
 */
const ImportNovelDialog: React.FC<ImportNovelDialogProps> = ({ isOpen, onClose, onImport }) => {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('url');
  const [toc, setToc] = useState<NovelToc | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [renderChapters, setRenderChapters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [selectedChapterIndexes, setSelectedChapterIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const [bookTitle, setBookTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const chapters = toc?.chapters ?? [];

  // Reset transient state every time the dialog reopens.
  useEffect(() => {
    if (!isOpen) return;
    setUrl('');
    setPhase('url');
    setToc(null);
    setSourceUrl('');
    setRenderChapters(false);
    setBusy(false);
    setError(null);
    setProgress({ done: 0, total: 0 });
    setSelectedChapterIndexes(new Set());
    setBookTitle('');
    setTitleEdited(false);
    return () => {
      requestRef.current++;
      abortRef.current?.abort();
    };
  }, [isOpen]);

  const close = () => {
    requestRef.current++;
    abortRef.current?.abort();
    onClose();
  };

  const surfaceError = (e: unknown) => {
    // Tauri's `invoke` rejects with the raw Err string from Rust; our
    // pipeline throws Error objects — surface either shape directly.
    const message =
      e instanceof Error ? e.message : typeof e === 'string' ? e : _('Could not fetch this page');
    setError(message);
  };

  const suggestedBookTitle = (novel: NovelToc, selected: Set<number>): string => {
    if (selected.size === 0) return novel.title;

    const indexes = [...selected].sort((a, b) => a - b);
    const first = indexes[0]! + 1;
    const last = indexes[indexes.length - 1]! + 1;
    if (indexes.length === 1) {
      return _('{{title}} Chapter {{chapter}}', { title: novel.title, chapter: first });
    }
    if (
      indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1)
    ) {
      return _('{{title}} Chapters {{first}} - {{last}}', {
        title: novel.title,
        first,
        last,
      });
    }
    return _('{{title}} ({{count}} chapters)', {
      title: novel.title,
      count: indexes.length,
    });
  };

  const updateChapterSelection = (selected: Set<number>) => {
    setSelectedChapterIndexes(selected);
    if (toc && !titleEdited) setBookTitle(suggestedBookTitle(toc, selected));
  };

  const fetchToc = async (page?: WebBrowserPage) => {
    const target = page?.url ?? url.trim();
    if (!/^https?:\/\//i.test(target)) {
      setError(_('Enter a URL starting with http:// or https://'));
      return;
    }
    const request = ++requestRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const parsed = await fetchNovelToc(target, {
        signal: controller.signal,
        ...(page ? { page: { html: page.html, finalUrl: page.url } } : {}),
      });
      if (request !== requestRef.current || controller.signal.aborted) return;
      const selected = new Set(parsed.chapters.map((_, index) => index));
      setToc(parsed);
      setSourceUrl(target);
      setRenderChapters(!!page);
      setSelectedChapterIndexes(selected);
      setBookTitle(suggestedBookTitle(parsed, selected));
      setTitleEdited(false);
      setPhase('preview');
    } catch (e) {
      if (request === requestRef.current && !isNovelImportCancelled(e)) surfaceError(e);
    } finally {
      if (request === requestRef.current) {
        setBusy(false);
        abortRef.current = null;
      }
    }
  };

  const signIn = async () => {
    const target = url.trim();
    if (busy || !/^https?:\/\//i.test(target)) {
      if (!busy) setError(_('Enter a URL starting with http:// or https://'));
      return;
    }
    setBusy(true);
    setError(null);
    const request = ++requestRef.current;
    try {
      const options = getWebBrowserOptions(_, document.documentElement.dataset['eink'] === 'true');
      options.labels.clipPage = _('Use Chapter List');
      const result = await openWebBrowser(target, options);
      if (request !== requestRef.current) return;
      if (result.page) {
        setUrl(result.page.url);
        await fetchToc(result.page);
      }
    } catch (e) {
      if (request === requestRef.current) surfaceError(e);
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  };

  const startDownload = async () => {
    if (!toc) return;
    const selectedChapters = toc.chapters.filter((_, index) => selectedChapterIndexes.has(index));
    const title = bookTitle.trim();
    if (selectedChapters.length === 0 || !title) return;
    const selectedToc = { ...toc, title, chapters: selectedChapters };
    const identityKey =
      selectedChapters.length === toc.chapters.length
        ? sourceUrl
        : [sourceUrl, ...selectedChapters.map((chapter) => chapter.url)].join('\n');
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('downloading');
    setError(null);
    setProgress({ done: 0, total: selectedChapters.length });
    try {
      const book = await downloadNovel(selectedToc, sourceUrl, {
        signal: controller.signal,
        identityKey,
        renderChapters,
        translate: _,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (book.failures >= book.chapterCount) {
        setPhase('preview');
        setError(_('No chapters could be downloaded.'));
        return;
      }
      if (controller.signal.aborted) return;
      await onImport(book.file);
      if (book.failures > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('{{count}} chapters could not be downloaded.', { count: book.failures }),
          timeout: 5000,
        });
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Imported “{{title}}”', { title: book.title }),
          timeout: 3000,
        });
      }
      onClose();
    } catch (e) {
      if (isNovelImportCancelled(e)) {
        setPhase('preview');
        return;
      }
      setPhase('preview');
      surfaceError(e);
    } finally {
      abortRef.current = null;
    }
  };

  const allChaptersSelected =
    chapters.length > 0 && selectedChapterIndexes.size === chapters.length;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={_('Import Web Novel')}
      // Size to content — same override as WebSourcesDialog.
      boxClassName='sm:w-[480px]! sm:max-w-[480px]! sm:h-auto! sm:max-h-[80vh]!'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        {phase === 'url' && (
          <>
            <p className='text-base-content/60 text-sm leading-relaxed'>
              {_(
                'Paste the link to a web novel’s chapter list. For members-only sites, sign in with Browser, open the chapter list, then choose Use Chapter List.',
              )}
            </p>
            <input
              type='url'
              autoFocus
              className='input eink-bordered placeholder:text-base-content/35 w-full'
              placeholder='https://example.com/novel'
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchToc();
              }}
            />
            {error && <p className='text-error text-sm leading-relaxed'>{error}</p>}
            <div className='flex flex-wrap justify-end gap-2 pt-1'>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={close}
                disabled={busy}
              >
                {_('Cancel')}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={() => void signIn()}
                disabled={busy || !url.trim()}
              >
                {_('Sign in with Browser')}
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-sm'
                onClick={() => void fetchToc()}
                disabled={busy || !url.trim()}
              >
                {busy ? (
                  <span className='loading loading-spinner loading-xs' />
                ) : (
                  <MdMenuBook className='h-4 w-4' />
                )}
                {_('Fetch Chapters')}
              </button>
            </div>
          </>
        )}

        {phase === 'preview' && toc && (
          <>
            <div className='eink-bordered bg-base-200 flex flex-col gap-1 rounded-lg p-3'>
              <span className='truncate font-medium'>{toc.title}</span>
              {toc.author && (
                <span className='text-base-content/60 truncate text-sm'>{toc.author}</span>
              )}
              <span className='text-base-content/60 text-sm'>
                {_('{{count}} chapters', { count: chapters.length })}
              </span>
            </div>
            <div className='flex flex-col gap-1.5'>
              <label className='text-base-content/70 text-xs' htmlFor='novel-book-title'>
                {_('Book title')}
              </label>
              <input
                id='novel-book-title'
                type='text'
                className='input eink-bordered w-full'
                value={bookTitle}
                onChange={(e) => {
                  setBookTitle(e.target.value);
                  setTitleEdited(true);
                }}
              />
            </div>
            <div className='flex items-center justify-between gap-3'>
              <span className='text-base-content/60 text-sm' aria-live='polite'>
                {_('{{n}} selected', { n: selectedChapterIndexes.size })}
              </span>
              <button
                type='button'
                className='btn btn-ghost btn-xs eink-bordered touch-target'
                onClick={() => {
                  updateChapterSelection(
                    allChaptersSelected ? new Set() : new Set(chapters.map((_, index) => index)),
                  );
                }}
              >
                {allChaptersSelected ? _('Deselect all') : _('Select all')}
              </button>
            </div>
            <div
              className='eink-bordered border-base-200 bg-base-100 max-h-64 overflow-y-auto overscroll-contain rounded-lg border'
              role='group'
              aria-label={_('Chapters')}
            >
              {chapters.map((chapter, index) => (
                <label
                  key={`${chapter.url}-${index}`}
                  className='border-base-200 hover:bg-base-200/60 flex min-h-11 cursor-pointer items-center gap-3 border-b px-3 py-2 transition-colors duration-150 last:border-b-0'
                >
                  <input
                    type='checkbox'
                    className='checkbox checkbox-sm shrink-0'
                    checked={selectedChapterIndexes.has(index)}
                    onChange={() => {
                      const selected = new Set(selectedChapterIndexes);
                      if (selected.has(index)) selected.delete(index);
                      else selected.add(index);
                      updateChapterSelection(selected);
                    }}
                  />
                  <span className='min-w-0 break-words text-sm'>{chapter.title}</span>
                </label>
              ))}
            </div>
            {error && <p className='text-error text-sm leading-relaxed'>{error}</p>}
            <div className='flex justify-end gap-2 pt-1'>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={() => {
                  setError(null);
                  setPhase('url');
                }}
              >
                {_('Back')}
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-sm'
                onClick={() => void startDownload()}
                disabled={selectedChapterIndexes.size === 0 || !bookTitle.trim()}
              >
                <MdMenuBook className='h-4 w-4' />
                {_('Import')}
              </button>
            </div>
          </>
        )}

        {phase === 'downloading' && (
          <div className='flex flex-col gap-8 py-6'>
            <div className='flex items-start gap-4'>
              <MdMenuBook
                aria-hidden='true'
                className='text-base-content/70 mt-1 h-8 w-8 shrink-0'
              />
              <div className='min-w-0 space-y-1'>
                <p className='break-words text-lg font-semibold leading-snug'>{bookTitle}</p>
                <p className='text-base-content/60 text-sm'>{_('Downloading chapters…')}</p>
              </div>
            </div>
            <div className='space-y-3'>
              <div className='flex justify-between gap-4 text-sm tabular-nums' role='status'>
                <span className='text-base-content/70'>
                  {progress.done} / {progress.total}
                </span>
                <span className='font-medium'>
                  {Math.round((progress.done / (progress.total || 1)) * 100)}%
                </span>
              </div>
              <progress
                aria-label={_('Downloading chapters…')}
                className='progress eink-bordered block h-2 w-full'
                value={progress.done}
                max={progress.total || 1}
              />
              <p className='text-base-content/60 text-sm leading-relaxed'>
                {progress.done === progress.total
                  ? _('Preparing your book…')
                  : _('Keep Readest open until the import is complete.')}
              </p>
            </div>
            <div className='flex justify-center'>
              <button
                type='button'
                className='btn btn-ghost eink-bordered min-h-11 px-6'
                onClick={() => abortRef.current?.abort()}
              >
                {_('Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default ImportNovelDialog;
