import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { MdArrowDropDown, MdSearch } from 'react-icons/md';
import { IoMdCloseCircle } from 'react-icons/io';
import {
  PiArrowsClockwise,
  PiBooks,
  PiCardsThree,
  PiDotsThreeVertical,
  PiDownloadSimple,
  PiExport,
  PiFileCsv,
} from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { filterEntries, lastSeen, listBooks } from '@/services/vocabulary/filter';
import { toAnkiText, toCsv } from '@/services/vocabulary/export';
import type { VocabularyState } from '@/services/vocabulary/types';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import AnkiImportPanel from './AnkiImportPanel';
import VocabularyDetail from './VocabularyDetail';
import { useAnkiLink } from './useAnkiLink';

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
  const anki = useAnkiLink();

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

  const revealChip = (chip: Element | null) =>
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const exportAs = async (format: 'csv' | 'anki') => {
    if (format === 'anki' && !anki.guardFileExport()) return;
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

  const importPanel = anki.importState && (
    <AnkiImportPanel {...anki.importState} onImport={anki.runImport} onCancel={anki.closeImport} />
  );

  if (all.every((e) => e.deletedAt)) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center'>
        {importPanel || (
          <>
            <p className='not-eink:opacity-70 text-sm'>
              {_('Words you look up while reading appear here.')}
            </p>
            {anki.available && (
              <button
                type='button'
                className='btn btn-contrast btn-sm gap-2'
                onClick={() => void anki.openImport()}
              >
                {_('Import from Anki')}
                {anki.premiumBadge && (
                  <span className='badge badge-sm badge-ghost'>{anki.premiumBadge}</span>
                )}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center gap-2 pb-3'>
        <label className='eink-bordered bg-base-200 not-eink:focus-within:bg-base-300/60 eink:focus-within:ring-2 eink:focus-within:ring-base-content flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-3.5'>
          <MdSearch aria-hidden='true' className='text-base-content/50 h-5 w-5 shrink-0' />
          <input
            type='search'
            aria-label={_('Search')}
            placeholder={_('Search words')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='min-w-0 flex-1 bg-transparent text-sm focus:outline-hidden [&::-webkit-search-cancel-button]:hidden'
          />
          {query && (
            <button
              type='button'
              aria-label={_('Clear')}
              onClick={() => setQuery('')}
              className='-me-2 flex h-8 w-8 shrink-0 items-center justify-center'
            >
              <IoMdCloseCircle className='text-base-content/50 h-4 w-4' />
            </button>
          )}
        </label>
        {anki.available && (
          <button
            type='button'
            aria-label={_('Sync with Anki')}
            title={_('Sync with Anki')}
            disabled={anki.syncing}
            onClick={() => void anki.sync()}
            className='btn btn-ghost btn-circle eink-bordered bg-base-200 h-10 min-h-10 w-10 p-0 disabled:opacity-40'
          >
            <PiArrowsClockwise className='h-5 w-5' />
          </button>
        )}
        <Dropdown
          // With AnkiDroid the menu also imports, so it isn't only Export.
          label={anki.available ? _('More') : _('Export')}
          disabled={!shown.length && !anki.available}
          className='dropdown-bottom dropdown-end'
          buttonClassName='btn btn-ghost btn-circle eink-bordered bg-base-200 h-10 min-h-10 w-10 p-0 disabled:opacity-40'
          toggleButton={
            anki.available ? (
              <PiDotsThreeVertical className='h-5 w-5' />
            ) : (
              <PiExport className='h-5 w-5' />
            )
          }
        >
          <Menu className='dropdown-content no-triangle border-base-300 bg-base-100 z-20 mt-1 min-w-48 rounded-lg border shadow-lg'>
            <MenuItem
              label={_('Export CSV')}
              Icon={PiFileCsv}
              transient
              disabled={!shown.length}
              onClick={() => void exportAs('csv')}
            />
            <MenuItem
              label={_('Export to Anki')}
              description={anki.premiumBadge}
              Icon={PiCardsThree}
              transient
              disabled={!shown.length}
              onClick={() => void exportAs('anki')}
            />
            {anki.available && (
              <MenuItem
                label={_('Import Anki Deck...')}
                description={anki.premiumBadge}
                Icon={PiDownloadSimple}
                transient
                onClick={() => void anki.openImport()}
              />
            )}
          </Menu>
        </Dropdown>
      </div>

      <div
        role='group'
        aria-label={_('Filter')}
        className='no-scrollbar -mx-4 flex scroll-px-4 items-center gap-2 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:scroll-px-6 sm:px-6'
      >
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
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap',
                active ? 'btn-contrast' : 'eink-bordered bg-base-200 not-eink:hover:bg-base-300/60',
              )}
            >
              <span>{f.label}</span>
              <span className='not-eink:opacity-60 text-xs tabular-nums'>{count}</span>
            </button>
          );
        })}
        <div
          // The picker lines up with this chip's edge; a half-hidden chip at the
          // end of the row would open a half-hidden picker.
          onPointerDown={(e) => revealChip(e.currentTarget)}
          className={clsx(
            '[anchor-name:--settings-select] [anchor-scope:--settings-select]',
            'relative flex h-8 max-w-52 shrink-0 items-center rounded-full',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-base-content/15 eink:has-[:focus-visible]:ring-base-content',
            bookHash ? 'btn-contrast' : 'eink-bordered bg-base-200',
          )}
        >
          <PiBooks aria-hidden='true' className='pointer-events-none absolute start-3 h-4 w-4' />
          <select
            aria-label={_('Book')}
            value={bookHash}
            onChange={(e) => {
              setBookHash(e.target.value);
              // The chip widens to the book's title; keep all of it in view.
              const chip = e.currentTarget.parentElement;
              requestAnimationFrame(() => revealChip(chip));
            }}
            className='select h-8 min-h-8 min-w-0 cursor-pointer truncate rounded-full border-0! bg-transparent! bg-none! ps-8! pe-7! text-sm text-inherit shadow-none! outline-hidden!'
          >
            <option value=''>{_('All Books')}</option>
            {books.map((b) => (
              <option key={b.hash} value={b.hash}>
                {b.title}
              </option>
            ))}
          </select>
          <MdArrowDropDown
            aria-hidden='true'
            className='pointer-events-none absolute end-1.5 h-5 w-5 opacity-60'
          />
        </div>
      </div>

      <div className='border-base-content/10 flex min-h-0 flex-1 border-t'>
        {importPanel || (
          <>
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
                      <span dir='auto' className='min-w-0 truncate font-semibold'>
                        {e.word}
                      </span>
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
                <li className='not-eink:opacity-60 p-4 text-center text-sm'>
                  {_('No words match')}
                </li>
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
          </>
        )}
      </div>
    </div>
  );
};

export default VocabularyView;
