'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MdMenuBook } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { downloadNovel, fetchNovelToc, isNovelImportCancelled } from '@/services/novel/novelImport';
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
 * a cancellable download progress bar. Tauri-only, like "From Web URL" — a
 * web build can't fetch cross-origin pages.
 */
const ImportNovelDialog: React.FC<ImportNovelDialogProps> = ({ isOpen, onClose, onImport }) => {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('url');
  const [toc, setToc] = useState<NovelToc | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);

  // Reset transient state every time the dialog reopens.
  useEffect(() => {
    if (!isOpen) return;
    setUrl('');
    setPhase('url');
    setToc(null);
    setSourceUrl('');
    setBusy(false);
    setError(null);
    setProgress({ done: 0, total: 0 });
  }, [isOpen]);

  const close = () => {
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

  const fetchToc = async () => {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      setError(_('Enter a URL starting with http:// or https://'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parsed = await fetchNovelToc(target);
      setToc(parsed);
      setSourceUrl(target);
      setPhase('preview');
    } catch (e) {
      surfaceError(e);
    } finally {
      setBusy(false);
    }
  };

  const startDownload = async () => {
    if (!toc) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('downloading');
    setError(null);
    setProgress({ done: 0, total: toc.chapters.length });
    try {
      const book = await downloadNovel(toc, sourceUrl, {
        signal: controller.signal,
        translate: _,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (book.failures >= book.chapterCount) {
        setPhase('preview');
        setError(_('No chapters could be downloaded.'));
        return;
      }
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

  const chapters = toc?.chapters ?? [];
  const firstChapter = chapters[0];
  const lastChapter = chapters[chapters.length - 1];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={_('Import Web Novel')}
      // Size to content — same override as ImportFromUrlDialog.
      boxClassName='sm:!w-[480px] sm:!max-w-[480px] sm:!h-auto sm:!max-h-[80vh]'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        {phase === 'url' && (
          <>
            <p className='text-base-content/60 text-sm leading-relaxed'>
              {_(
                'Paste the link to a web novel’s chapter list. Readest downloads the chapters and saves them as a book.',
              )}
            </p>
            <input
              type='url'
              autoFocus
              className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
              placeholder='https://example.com/novel'
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fetchToc();
              }}
            />
            {error && <p className='text-error text-sm leading-relaxed'>{error}</p>}
            <div className='flex justify-end gap-2 pt-1'>
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
            {firstChapter && lastChapter && (
              <div className='text-base-content/60 flex flex-col gap-1 text-sm leading-relaxed'>
                <span className='truncate'>{firstChapter.title}</span>
                {chapters.length > 2 && <span>…</span>}
                {chapters.length > 1 && <span className='truncate'>{lastChapter.title}</span>}
              </div>
            )}
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
              >
                <MdMenuBook className='h-4 w-4' />
                {_('Import')}
              </button>
            </div>
          </>
        )}

        {phase === 'downloading' && (
          <>
            <p className='text-base-content/60 text-sm leading-relaxed'>
              {_('Downloading chapters…')}
            </p>
            <progress
              className='progress eink-bordered w-full'
              value={progress.done}
              max={progress.total || 1}
            />
            <p className='text-base-content/60 text-sm'>
              {progress.done} / {progress.total}
            </p>
            <div className='flex justify-end gap-2 pt-1'>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={() => abortRef.current?.abort()}
              >
                {_('Cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};

export default ImportNovelDialog;
