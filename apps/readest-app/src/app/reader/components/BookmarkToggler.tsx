import React, { useEffect, useState } from 'react';
import { MdOutlineBookmarkAdd, MdOutlineBookmark } from 'react-icons/md';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import Button from '@/components/Button';
import { getCurrentPage } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { isCfiInLocation } from '@/utils/cfi';

interface BookmarkTogglerProps {
  bookKey: string;
}

const BookmarkToggler: React.FC<BookmarkTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { getProgress, getViewState, setBookmarkRibbonVisibility } = useReaderStore();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const config = getConfig(bookKey);
  const progress = getProgress(bookKey);

  const toggleBookmark = () => {
    const bookData = getBookData(bookKey);
    const config = getConfig(bookKey);
    const progress = getProgress(bookKey);
    if (!bookData || !config || !progress) return;

    const { booknotes: bookmarks = [] } = config;
    const { location: cfi, range } = progress;
    if (!cfi) return;
    const isBookmarked = getViewState(bookKey)?.ribbonVisible;
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
      bookmarks.forEach((item) => {
        if (item.type === 'bookmark' && isCfiInLocation(item.cfi, cfi)) {
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
    const handleBookmarkToggle = (e: CustomEvent) => {
      const { bookKey: eventBookKey } = e.detail;
      if (eventBookKey !== bookKey) return;
      toggleBookmark();
    };
    eventDispatcher.on('toggle-bookmark', handleBookmarkToggle);
    return () => {
      eventDispatcher.off('toggle-bookmark', handleBookmarkToggle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    const { booknotes = [] } = config || {};
    const { location: cfi } = progress || {};
    if (!cfi) return;

    const locationBookmarked = booknotes
      .filter((booknote) => booknote.type === 'bookmark' && !booknote.deletedAt)
      .some((item) => isCfiInLocation(item.cfi, cfi));
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
      label={isBookmarked ? _('Remove Bookmark') : _('Add Bookmark')}
    ></Button>
  );
};

export default BookmarkToggler;
