import React, { useMemo } from 'react';
import * as CFI from 'foliate-js/epubcfi.js';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { findTocItemBS } from '@/services/nav';
import { findNearestCfi } from '@/utils/cfi';
import { TOCItem } from '@/libs/document';
import { BooknoteGroup, BookNoteType } from '@/types/book';
import BooknoteItem from './BooknoteItem';

const BooknoteView: React.FC<{
  type: BookNoteType;
  bookKey: string;
  toc: TOCItem[];
}> = ({ type, bookKey, toc }) => {
  const _ = useTranslation();
  const { getConfig } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const { setActiveBooknoteType, setBooknoteResults } = useSidebarStore();
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey);

  const { booknotes: allNotes = [] } = config;
  const booknotes = allNotes.filter((note) => note.type === type && !note.deletedAt);

  const booknoteGroups: { [href: string]: BooknoteGroup } = {};
  for (const booknote of booknotes) {
    const tocItem = findTocItemBS(toc ?? [], booknote.cfi);
    const href = tocItem?.href || '';
    const label = tocItem?.label || '';
    const id = tocItem?.id || 0;
    if (!booknoteGroups[href]) {
      booknoteGroups[href] = { id, href, label, booknotes: [] };
    }
    booknoteGroups[href].booknotes.push(booknote);
  }

  Object.values(booknoteGroups).forEach((group) => {
    group.booknotes.sort((a, b) => {
      return CFI.compare(a.cfi, b.cfi);
    });
  });

  const sortedGroups = Object.values(booknoteGroups).sort((a, b) => {
    return a.id - b.id;
  });

  const nearestCfi = useMemo(() => {
    const allSorted = sortedGroups.flatMap((g) => g.booknotes.map((n) => n.cfi));
    return findNearestCfi(allSorted, progress?.location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location, sortedGroups.length]);

  const handleBrowseBookNotes = () => {
    if (booknotes.length === 0) return;

    const sorted = [...booknotes].sort((a, b) => CFI.compare(a.cfi, b.cfi));
    setActiveBooknoteType(bookKey, type);
    setBooknoteResults(bookKey, sorted);
  };

  return (
    <div className='rounded pt-1'>
      {sortedGroups.length === 0 ? (
        <div className='flex min-h-[180px] flex-col items-center justify-center px-4 py-8 text-center'>
          <div className='border-[#6a4d28]/28 bg-[#1a110f]/72 mb-3 rounded-full border px-3 py-2 font-serif text-[11px] font-semibold uppercase tracking-[0.22em] text-[#b89557]'>
            {type === 'annotation' ? _('Notes') : _('Bookmarks')}
          </div>
          <p className='text-[#d0bb92]/82 text-sm'>
            {type === 'annotation'
              ? _('No notes for this book yet.')
              : _('No bookmarks saved yet.')}
          </p>
          <p className='mt-1 text-xs text-[#8e7348]'>
            {type === 'annotation'
              ? _('Highlights and marginal notes will appear here.')
              : _('Saved places will appear here as you mark them.')}
          </p>
        </div>
      ) : (
        <ul role='tree' className='px-1.5'>
          {sortedGroups.map((group) => (
            <li
              key={group.href}
              className='border-[#5e4525]/18 mb-3 rounded-[22px] border bg-[linear-gradient(180deg,rgba(17,11,10,0.82),rgba(9,7,6,0.9))] px-2.5 py-2.5 last:mb-0'
            >
              <h3 className='border-[#5e4525]/22 line-clamp-1 border-b pb-1.5 font-serif text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c7ab74]'>
                {group.label}
              </h3>
              <ul>
                {group.booknotes.map((item, index) => (
                  <BooknoteItem
                    key={`${index}-${item.cfi}`}
                    bookKey={bookKey}
                    item={item}
                    isNearest={item.cfi === nearestCfi}
                    onClick={handleBrowseBookNotes}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default BooknoteView;
