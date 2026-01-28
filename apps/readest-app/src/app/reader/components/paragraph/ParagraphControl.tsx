'use client';

import React from 'react';
import { FoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useReaderStore } from '@/store/readerStore';
import { useParagraphMode } from '../../hooks/useParagraphMode';
import ParagraphBar from './ParagraphBar';
import ParagraphOverlay from './ParagraphOverlay';

const DIM_OPACITY = 0.3;

interface ParagraphControlProps {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
  gridInsets: Insets;
}

const ParagraphControl: React.FC<ParagraphControlProps> = ({ bookKey, viewRef, gridInsets }) => {
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const {
    paragraphState,
    paragraphConfig,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
  } = useParagraphMode({ bookKey, viewRef });

  if (!paragraphConfig?.enabled) {
    return null;
  }

  return (
    <>
      <ParagraphOverlay
        bookKey={bookKey}
        dimOpacity={DIM_OPACITY}
        viewSettings={viewSettings ?? undefined}
        onClose={toggleParagraphMode}
      />
      <ParagraphBar
        bookKey={bookKey}
        currentIndex={paragraphState.currentIndex}
        totalParagraphs={paragraphState.totalParagraphs}
        onPrev={goToPrevParagraph}
        onNext={goToNextParagraph}
        onClose={toggleParagraphMode}
        gridInsets={gridInsets}
      />
    </>
  );
};

export default ParagraphControl;
