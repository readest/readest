import React, { useCallback } from 'react';
import { IoShareOutline } from 'react-icons/io5';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';

interface ShareTogglerProps {
  bookKey: string;
}

// Reader top-bar Share button. Matches BookmarkToggler/TranslationToggler
// shape so it slots into the existing header rhythm.
const ShareToggler: React.FC<ShareTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const { getProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();

  const handleShare = useCallback(() => {
    const bookData = getBookData(bookKey);
    if (!bookData?.book) return;
    const progress = getProgress(bookKey);
    eventDispatcher.dispatch('show-share-dialog', {
      book: bookData.book,
      cfi: progress?.location ?? null,
    });
  }, [bookKey, getBookData, getProgress]);

  return (
    <button
      title={_('Share Book')}
      type='button'
      onClick={handleShare}
      className='btn btn-ghost h-8 min-h-8 w-8 p-0'
      aria-label={_('Share Book')}
    >
      <IoShareOutline size={iconSize18} className='fill-base-content' />
    </button>
  );
};

export default ShareToggler;
