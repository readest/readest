import React from 'react';
import * as CFI from 'foliate-js/epubcfi.js';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { findTocItemBS } from '@/utils/toc';
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
  const { setActiveBooknoteType, setBooknoteResults } = useSidebarStore();
  const { settings } = useSettingsStore();
  const config = getConfig(bookKey)!;

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

  const handleSendAllToReadwise = () => {
    eventDispatcher.dispatch('readwise-push-all', { bookKey });
  };

  const handleBrowseBookNotes = () => {
    if (booknotes.length === 0) return;

    const sorted = [...booknotes].sort((a, b) => CFI.compare(a.cfi, b.cfi));
    setActiveBooknoteType(bookKey, type);
    setBooknoteResults(bookKey, sorted);
  };

  return (
    <div className='rounded pt-2'>
      {settings.readwise?.enabled && booknotes.length > 0 && (
        <div className='flex justify-end px-2 pb-1'>
          <button className='btn btn-xs btn-outline' onClick={handleSendAllToReadwise}>
            {_('Send All to Readwise')}
          </button>
        </div>
      )}
      <ul role='tree' className='px-2'>
        {sortedGroups.map((group) => (
          <li key={group.href} className='p-2'>
            <h3 className='content font-size-base line-clamp-1 font-normal'>{group.label}</h3>
            <ul>
              {group.booknotes.map((item, index) => (
                <BooknoteItem
                  key={`${index}-${item.cfi}`}
                  bookKey={bookKey}
                  item={item}
                  onClick={handleBrowseBookNotes}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BooknoteView;
