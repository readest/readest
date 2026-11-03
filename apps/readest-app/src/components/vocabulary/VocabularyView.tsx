import React, { useMemo, useState } from 'react';
import clsx from 'clsx';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { filterEntries, lastSeen, listBooks } from '@/services/vocabulary/filter';
import { toAnkiText, toCsv } from '@/services/vocabulary/export';
import type { VocabularyState } from '@/services/vocabulary/types';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import VocabularyDetail from './VocabularyDetail';

interface VocabularyViewProps {
  /** Called before leaving for the reader (Open in book), to close the window. */
  onOpenBook?: () => void;
}

const VocabularyView: React.FC<VocabularyViewProps> = ({ onOpenBook }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const entries = useVocabularyStore((s) => s.entries);
  const [state, setState] = useState<VocabularyState | undefined>();
  const [bookHash, setBookHash] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = useMemo(() => Object.values(entries), [entries]);
  const books = useMemo(() => listBooks(all), [all]);
  const byBook = useMemo(
    () => filterEntries(all, { bookHash: bookHash || undefined, query }),
    [all, bookHash, query],
  );
  const shown = useMemo(
    () => (state ? byBook.filter((e) => e.state === state) : byBook),
    [byBook, state],
  );
  const selected = selectedId ? entries[selectedId] : undefined;
  const detail = selected && !selected.deletedAt ? selected : undefined;

  const stateFilters: { state?: VocabularyState; label: string }[] = [
    { label: _('All') },
    { state: 'none', label: _('Looked Up') },
    { state: 'learning', label: _('Learning') },
    { state: 'mastered', label: _('Mastered') },
  ];

  const exportAs = async (format: 'csv' | 'anki') => {
    const content = format === 'csv' ? toCsv(shown) : toAnkiText(shown);
    const filename = format === 'csv' ? 'readest-vocabulary.csv' : 'readest-vocabulary-anki.txt';
    const saved = await appService?.saveFile(filename, content, {
      mimeType: format === 'csv' ? 'text/csv' : 'text/plain',
    });
    eventDispatcher.dispatch('toast', {
      type: saved ? 'info' : 'warning',
      message: saved ? _('Exported successfully') : _('Failed to export vocabulary.'),
      timeout: 2000,
    });
  };

  if (all.every((e) => e.deletedAt)) {
    return (
      <div className='flex h-full flex-col items-center justify-center px-6 py-12 text-center'>
        <p className='not-eink:opacity-70 text-sm'>
          {_('Words you look up while reading appear here.')}
        </p>
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-wrap items-center gap-2 pb-2'>
        <input
          type='search'
          aria-label={_('Search')}
          placeholder={_('Search words')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='eink-bordered input input-sm border-base-content/20 min-w-0 flex-1'
        />
        <button
          type='button'
          className='btn btn-ghost btn-sm eink-bordered'
          disabled={!shown.length}
          onClick={() => void exportAs('csv')}
        >
          {_('Export CSV')}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm eink-bordered'
          disabled={!shown.length}
          onClick={() => void exportAs('anki')}
        >
          {_('Export to Anki')}
        </button>
      </div>

      <div className='flex flex-wrap items-center gap-2 pb-2'>
        {stateFilters.map((f) => {
          const active = state === f.state;
          const count = f.state ? byBook.filter((e) => e.state === f.state).length : byBook.length;
          return (
            <button
              key={f.label}
              type='button'
              aria-pressed={active}
              onClick={() => setState(f.state)}
              className={clsx(
                'h-7 rounded-full border px-3 text-xs',
                active
                  ? 'btn-contrast'
                  : 'eink-bordered border-base-content/20 not-eink:hover:bg-base-200/60',
              )}
            >
              {`${f.label} ${count}`}
            </button>
          );
        })}
        <select
          aria-label={_('Book')}
          value={bookHash}
          onChange={(e) => setBookHash(e.target.value)}
          className='eink-bordered select select-sm border-base-content/20 ms-auto max-w-48'
        >
          <option value=''>{_('All Books')}</option>
          {books.map((b) => (
            <option key={b.hash} value={b.hash}>
              {b.title}
            </option>
          ))}
        </select>
      </div>

      <div className='border-base-content/10 flex min-h-0 flex-1 border-t'>
        <ul
          aria-label={_('Words')}
          className={clsx(
            'min-h-0 w-full overflow-y-auto sm:w-2/5 sm:border-e sm:border-base-content/10',
            detail ? 'hidden sm:block' : 'block',
          )}
        >
          {shown.map((e) => (
            <li key={e.id}>
              <button
                type='button'
                aria-label={e.word}
                data-word={e.key}
                aria-current={e.id === detail?.id}
                onClick={() => setSelectedId(e.id)}
                className={clsx(
                  'border-base-content/5 flex w-full flex-col items-start border-b px-3 py-2 text-start',
                  e.id === detail?.id ? 'bg-base-200' : 'not-eink:hover:bg-base-200/60',
                )}
              >
                <span className='flex w-full items-center gap-2'>
                  <span className='min-w-0 truncate font-semibold'>{e.word}</span>
                  {e.state !== 'none' && (
                    <span
                      className={clsx(
                        'rounded-full border px-1.5 text-[10px]',
                        e.state === 'learning'
                          ? 'btn-contrast'
                          : 'eink-bordered border-base-content/30',
                      )}
                    >
                      {e.state === 'learning' ? _('Learning') : _('Mastered')}
                    </span>
                  )}
                </span>
                <span className='not-eink:opacity-60 w-full truncate text-xs'>
                  {[
                    e.occurrences[0]?.bookTitle,
                    new Date(lastSeen(e)).toLocaleDateString(getLocale()),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
          {!shown.length && (
            <li className='not-eink:opacity-60 p-4 text-center text-sm'>{_('No words match')}</li>
          )}
        </ul>
        <div className={clsx('min-h-0 flex-1', detail ? 'flex' : 'hidden sm:flex')}>
          {detail ? (
            <VocabularyDetail
              entry={detail}
              onBack={() => setSelectedId(null)}
              onOpenBook={onOpenBook}
            />
          ) : (
            <p className='not-eink:opacity-60 m-auto p-4 text-sm'>{_('Select a word')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VocabularyView;
