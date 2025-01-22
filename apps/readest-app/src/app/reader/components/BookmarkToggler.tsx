import React, { useEffect, useState } from 'react';
import { MdOutlineBookmarkAdd, MdOutlineBookmark } from 'react-icons/md';
import * as CFI from 'foliate-js/epubcfi.js';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import Button from '@/components/Button';
import { getCurrentPage } from '@/utils/book';

interface BookmarkTogglerProps {
  bookKey: string;
}

const BookmarkToggler: React.FC<BookmarkTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { getProgress, setBookmarkRibbonVisibility } = useReaderStore();
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey)!;
  const bookData = getBookData(bookKey)!;

  const [isBookmarked, setIsBookmarked] = useState(false);

  const toggleBookmark = () => {
    const { booknotes: bookmarks = [] } = config;
    const { location: cfi, range } = progress;
    if (!cfi) return;
    if (!isBookmarked) {
      setIsBookmarked(true);
      const text = range?.startContainer.textContent?.slice(0, 128) || '';
      const truncatedText = text.length === 128 ? text + '...' : text;
      const bookmark: BookNote = {
        id: uniqueId(),
        type: 'bookmark',
        cfi,
        text: truncatedText ? truncatedText : `${getCurrentPage(bookData.book!, progress)}`,
        note: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const existingBookmark = bookmarks.find(
        (item) => item.type === 'bookmark' && item.cfi === cfi,
      );
      if (existingBookmark) {
        existingBookmark.deletedAt = null;
        existingBookmark.updatedAt = Date.now();
        existingBookmark.text = bookmark.text;
      } else {
        bookmarks.push(bookmark);
      }
      const updatedConfig = updateBooknotes(bookKey, bookmarks);
      if (updatedConfig) {
        saveConfig(envConfig, bookKey, updatedConfig, settings);
      }
    } else {
      setIsBookmarked(false);
      const start = CFI.collapse(cfi);
      const end = CFI.collapse(cfi, true);
      bookmarks.forEach((item) => {
        if (
          item.type === 'bookmark' &&
          CFI.compare(start, item.cfi) * CFI.compare(end, item.cfi) <= 0
        ) {
          item.deletedAt = Date.now();
        }
      });
      const updatedConfig = updateBooknotes(bookKey, bookmarks);
      if (updatedConfig) {
        saveConfig(envConfig, bookKey, updatedConfig, settings);
      }
    }
  };

  useEffect(() => {
    const { booknotes = [] } = config || {};
    const { location: cfi } = progress || {};
    if (!cfi) return;

    const start = CFI.collapse(cfi);
    const end = CFI.collapse(cfi, true);
    const locationBookmarked = booknotes
      .filter((booknote) => booknote.type === 'bookmark' && !booknote.deletedAt)
      .some((item) => CFI.compare(start, item.cfi) * CFI.compare(end, item.cfi) <= 0);
    setIsBookmarked(locationBookmarked);
    setBookmarkRibbonVisibility(bookKey, locationBookmarked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, progress]);

  return (
    <Button
      icon={
        isBookmarked ? (
          <MdOutlineBookmark className='text-base-content' />
        ) : (
          <MdOutlineBookmarkAdd className='text-base-content' />
        )
      }
      onClick={toggleBookmark}
      tooltip={_('Bookmark')}
      tooltipDirection='bottom'
    ></Button>
  );
};

export default BookmarkToggler;
