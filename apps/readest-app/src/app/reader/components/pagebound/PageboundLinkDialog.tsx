'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { MdCheck, MdMenuBook, MdSearch } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { PageboundClient, type PageboundBookCandidate } from '@/services/pagebound';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { PageboundBookLink } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

interface PageboundLinkDialogProps {
  bookKey: string;
  onClose: () => void;
}

/**
 * "Link Book" picker for Pagebound sync. Pagebound's search has no ISBN
 * lookup, so a title match can pick the wrong book; the user's choice is
 * stored in the book config and wins over the automatic match afterwards.
 */
const PageboundLinkDialog = ({ bookKey, onClose }: PageboundLinkDialogProps) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const getConfig = useBookDataStore((state) => state.getConfig);
  const getBookData = useBookDataStore((state) => state.getBookData);
  const setConfig = useBookDataStore((state) => state.setConfig);
  const saveConfig = useBookDataStore((state) => state.saveConfig);
  const book = getBookData(bookKey)?.book;
  const linked = getConfig(bookKey)?.pagebound ?? null;

  // Title only: Pagebound spells authors its own way, and every query word must match.
  const [query, setQuery] = useState(() => book?.title?.trim() ?? '');
  const [results, setResults] = useState<PageboundBookCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchSeq = useRef(0);

  const runSearch = async (text: string) => {
    const seq = ++searchSeq.current;
    setError('');
    setSearching(true);
    try {
      // Search is anonymous; the session is never used or renewed here.
      const found = await new PageboundClient(settings.pagebound, () => {}).searchBooks(text);
      if (seq === searchSeq.current) setResults(found);
    } catch (cause) {
      if (seq === searchSeq.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  useEffect(() => {
    if (query) void runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (link: PageboundBookLink | undefined, message: string) => {
    setError('');
    setBusy(true);
    try {
      const current = getConfig(bookKey);
      if (!current) throw new Error(_('Book configuration is unavailable'));
      await saveConfig(
        envConfig,
        bookKey,
        { ...current, pagebound: link, updatedAt: Date.now() },
        settings,
      );
      setConfig(bookKey, { pagebound: link });
      eventDispatcher.dispatch('toast', { type: 'info', message });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const linkTo = (candidate: PageboundBookCandidate) =>
    persist(
      { bookId: candidate.bookId, uuid: candidate.uuid, title: candidate.title },
      _('Linked to “{{title}}”', { title: candidate.title }),
    );

  const unlink = () =>
    persist(undefined, _('Pagebound link removed. The next sync will match the book again.'));

  return (
    <Dialog
      id='pagebound-link-dialog'
      isOpen
      dismissible={!busy}
      title={_('Link Pagebound Book')}
      onClose={onClose}
      boxClassName='sm:h-[80%] sm:min-w-[560px] sm:max-w-[680px]'
      contentClassName='px-6! sm:px-8!'
      useOverlayScroll
    >
      <div className='pb-6 pt-2'>
        <div className='mb-5'>
          <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>
            {_('Link Pagebound Book')}
          </h2>
          <p className='text-neutral-content leading-relaxed'>
            {_(
              'Pick the Pagebound book that matches “{{book}}”. Reading progress will sync to it.',
              {
                book: book?.title ?? '',
              },
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
              className='btn btn-ghost btn-sm text-error shrink-0'
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
            className='input eink-bordered settings-content h-10 min-w-0 flex-1 focus:outline-hidden'
            placeholder={_('Search Pagebound')}
            aria-label={_('Search Pagebound')}
            spellCheck='false'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type='submit'
            className='btn btn-contrast h-10 min-h-10 shrink-0'
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
              const isLinked = linked?.uuid === candidate.uuid;
              return (
                <li
                  key={candidate.uuid}
                  className='overflow-hidden first:rounded-t-lg last:rounded-b-lg'
                >
                  <button
                    type='button'
                    className={clsx(
                      'hover:bg-base-200/60 flex w-full items-center gap-3 px-4 py-3 text-start',
                      'focus-visible:bg-base-200/60 focus-visible:outline-hidden',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                    aria-pressed={isLinked}
                    disabled={busy}
                    onClick={() => linkTo(candidate)}
                  >
                    <span className='bg-base-200 text-base-content/55 flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xs'>
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
                        {candidate.author}
                      </span>
                    </span>
                    {isLinked && <MdCheck className='h-5 w-5 shrink-0' aria-label={_('Linked')} />}
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

export default PageboundLinkDialog;
