import React, { useState } from 'react';
import { Book } from '@/types/book';
import { Insets } from '@/types/misc';
import { convertBlobUrlToDataUrl } from '@/libs/document';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import ImageViewer from '@/app/reader/components/ImageViewer';
import ModalPortal from './ModalPortal';

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

interface BookCoverViewerProps {
  src: string;
  onClose: () => void;
}

// Shows a book cover full screen in the reader's image viewer (#5813), so the
// sidebar / Book Details thumbnail can be blown up to show someone without
// leaving the reading position. Portaled to the top modal layer so it covers
// whatever it was opened from (the sidebar, the Book Details dialog).
const BookCoverViewer: React.FC<BookCoverViewerProps> = ({ src, onClose }) => {
  const { safeAreaInsets } = useThemeStore();
  return (
    <ModalPortal showOverlay={false}>
      <ImageViewer gridInsets={safeAreaInsets ?? ZERO_INSETS} src={src} onClose={onClose} />
    </ModalPortal>
  );
};

// Loads the cover on demand; the viewer wants a data URL (its save button
// extracts the bytes from it), as for in-book images in FoliateViewer.
export const useBookCoverViewer = (book: Book) => {
  const hideCovers = useSettingsStore((state) => state.settings.libraryHideCovers);
  const [coverSrc, setCoverSrc] = useState<string | null>(null);

  const openCoverViewer = async () => {
    // The full-resolution cover, not the downscaled library thumbnail that
    // <BookCover> may be painting in its place.
    const coverUrl = hideCovers ? null : book.metadata?.coverImageUrl || book.coverImageUrl;
    if (!coverUrl) return;
    try {
      setCoverSrc(await convertBlobUrlToDataUrl(coverUrl));
    } catch (error) {
      console.error('Failed to load book cover:', error);
    }
  };

  const closeCoverViewer = () => setCoverSrc(null);

  return { coverSrc, openCoverViewer, closeCoverViewer };
};

export default BookCoverViewer;
