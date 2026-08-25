'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { MdCheck, MdMenuBook, MdSearch } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  HardcoverClient,
  HardcoverSyncMapStore,
  pickAutoMatch,
  type HardcoverBookCandidate,
} from '@/services/hardcover';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { HardcoverBookLink } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';

interface HardcoverLinkDialogProps {
  bookKey: string;
  onClose: () => void;
}

const compactNumber = (value: number) =>
  new Intl.NumberFormat(getLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );

/**
 * "Link Book" picker for Hardcover sync (#5846). Lets the user say which
 * Hardcover book this file is when the automatic ISBN / title match picks the
 * wrong entry (an audiobook, a duplicate). The choice is stored in the book
 * config and wins over every automatic match afterwards.
 */
const HardcoverLinkDialog = ({ bookKey, onClose }: HardcoverLinkDialogProps) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const getConfig = useBookDataStore((state) => state.getConfig);
  const getBookData = useBookDataStore((state) => state.getBookData);
  const setConfig = useBookDataStore((state) => state.setConfig);
  const saveConfig = useBookDataStore((state) => state.saveConfig);
  const book = getBookData(bookKey)?.book;
  const linked = getConfig(bookKey)?.hardcover ?? null;

  const [query, setQuery] = useState(() =>
    [book?.title, book?.author].filter(Boolean).join(' ').trim(),
  );
  const [results, setResults] = useState<HardcoverBookCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const servicesRef = useRef<{ client: HardcoverClient; mapStore: HardcoverSyncMapStore } | null>(
    null,
  );
  const searchSeq = useRef(0);
  // What the automatic match would pick from the book's own metadata, taken
  // from the search that runs on open. Notes synced before any link existed
  // belong to that book, so linking elsewhere must forget their mappings.
  const autoMatchIdRef = useRef<number | null>(null);

  const getServices = async () => {
    if (servicesRef.current) return servicesRef.current;
    const hardcover = settings.hardcover;
    if (!hardcover?.accessToken) throw new Error(_('Configure Hardcover in Settings first.'));
    const mapStore = new HardcoverSyncMapStore(await envConfig.getAppService());
    servicesRef.current = { client: new HardcoverClient(hardcover, mapStore), mapStore };
    return servicesRef.current;
  };

  const runSearch = async (text: string, initial = false) => {
    const seq = ++searchSeq.current;
    setError('');
    setSearching(true);
    try {
      const { client } = await getServices();
      const found = await client.searchBooks(text);
      if (seq === searchSeq.current) {
        setResults(found);
        if (initial) autoMatchIdRef.current = pickAutoMatch(found)?.bookId ?? null;
      }
    } catch (cause) {
      if (seq === searchSeq.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // Search once with the book's own metadata when the dialog opens.
  useEffect(() => {
    if (query) void runSearch(query, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (link: HardcoverBookLink | undefined) => {
    const current = getConfig(bookKey);
    if (!current) throw new Error(_('Book configuration is unavailable'));
    await saveConfig(
      envConfig,
      bookKey,
      { ...current, hardcover: link, updatedAt: Date.now() },
      settings,
    );
    setConfig(bookKey, { hardcover: link });
  };

  const linkTo = async (candidate: HardcoverBookCandidate) => {
    if (!book) return;
    setError('');
    setBusy(true);
    try {
      const next: HardcoverBookLink = { bookId: candidate.bookId, title: candidate.title };
      await persist(next);
      // Journal entries already synced belong to the previous book (the stored
      // link, or the automatic match before any link existed), so the notes
      // must be inserted afresh under the new one instead of updated in place.
      // Persist first: a failed clear leaves things no worse than before,
      // whereas a failed persist after a clear would re-insert every note
      // under the old book.
      const previousBookId = linked?.bookId ?? autoMatchIdRef.current;
      if (previousBookId != null && previousBookId !== next.bookId) {
        const { mapStore } = await getServices();
        await mapStore.clearForBook(book.hash);
      }
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Linked to “{{title}}”', { title: next.title }),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setError('');
    setBusy(true);
    try {
      await persist(undefined);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Hardcover link removed. The next sync will match the book again.'),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const describeCandidate = (candidate: HardcoverBookCandidate) =>
    [
      candidate.authors.join(', '),
      candidate.releaseYear,
      candidate.pages ? _('{{pages}} pages', { pages: candidate.pages }) : null,
      candidate.readersCount
        ? _('{{readers}} readers', { readers: compactNumber(candidate.readersCount) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Dialog
      id='hardcover-link-dialog'
      isOpen
      dismissible={!busy}
      title={_('Link Hardcover Book')}
      onClose={onClose}
      boxClassName='sm:h-[80%] sm:min-w-[560px] sm:max-w-[680px]'
      contentClassName='!px-6 sm:!px-8'
      useOverlayScroll
    >
      <div className='pb-6 pt-2'>
        <div className='mb-5'>
          <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>
            {_('Link Hardcover Book')}
          </h2>
          <p className='text-neutral-content leading-relaxed'>
            {_(
              'Pick the Hardcover book that matches “{{book}}”. Reading progress and notes will sync to it.',
              { book: book?.title ?? '' },
            )}
          </p>
        </div>

        {linked && (
          <div className='eink-bordered border-base-200 bg-base-100 mb-5 flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <p className='text-neutral-content text-[0.85em]'>{_('Currently linked')}</p>
              <p className='truncate font-medium'>{linked.title}</p>
            </div>
            <button
              type='button'
              className='btn btn-ghost btn-sm text-error flex-shrink-0'
              disabled={busy}
              onClick={unlink}
            >
              {_('Unlink')}
            </button>
          </div>
        )}

        <form
          className='mb-4 flex gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) void runSearch(query.trim());
          }}
        >
          <input
            type='search'
            className='input input-bordered eink-bordered settings-content h-10 min-w-0 flex-1 focus:outline-none'
            placeholder={_('Search Hardcover')}
            aria-label={_('Search Hardcover')}
            spellCheck='false'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type='submit'
            className='btn btn-contrast h-10 min-h-10 flex-shrink-0'
            disabled={searching || !query.trim()}
          >
            {searching ? (
              <span className='loading loading-spinner loading-sm' />
            ) : (
              <MdSearch className='h-5 w-5' />
            )}
            {_('Search')}
          </button>
        </form>

        {error && (
          <div
            className='eink-bordered border-error/50 bg-base-100 text-error mb-4 rounded-lg border px-4 py-3'
            role='alert'
          >
            {error}
          </div>
        )}

        {results && results.length === 0 && !searching && (
          <p className='text-neutral-content py-6 text-center'>
            {_('No matching books found. Try a different title or author.')}
          </p>
        )}

        {results && results.length > 0 && (
          <ul className='eink-bordered border-base-200 bg-base-100 divide-base-200 divide-y rounded-lg border'>
            {results.map((candidate) => {
              const isLinked = linked?.bookId === candidate.bookId;
              return (
                <li
                  key={candidate.bookId}
                  className='overflow-hidden first:rounded-t-lg last:rounded-b-lg'
                >
                  <button
                    type='button'
                    className={clsx(
                      'hover:bg-base-200/60 flex w-full items-center gap-3 px-4 py-3 text-start',
                      'focus-visible:bg-base-200/60 focus-visible:outline-none',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                    aria-pressed={isLinked}
                    disabled={busy}
                    onClick={() => linkTo(candidate)}
                  >
                    <span className='bg-base-200 text-base-content/55 flex h-14 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'>
                      {candidate.coverUrl ? (
                        <img
                          src={candidate.coverUrl}
                          alt=''
                          loading='lazy'
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <MdMenuBook className='h-5 w-5' aria-hidden='true' />
                      )}
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate font-medium'>{candidate.title}</span>
                      <span className='text-neutral-content block truncate text-[0.85em]'>
                        {describeCandidate(candidate)}
                      </span>
                      {(candidate.onShelf || !candidate.readable) && (
                        <span className='mt-1 flex flex-wrap gap-1.5'>
                          {candidate.onShelf && (
                            <span className='badge badge-sm badge-ghost'>{_('On your shelf')}</span>
                          )}
                          {!candidate.readable && (
                            <span className='badge badge-sm badge-ghost'>{_('Audiobook')}</span>
                          )}
                        </span>
                      )}
                    </span>
                    {isLinked && (
                      <MdCheck className='h-5 w-5 flex-shrink-0' aria-label={_('Linked')} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
};

export default HardcoverLinkDialog;
