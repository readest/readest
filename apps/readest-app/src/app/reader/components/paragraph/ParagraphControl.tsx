'use client';

import React, { useEffect, useRef } from 'react';
import { FoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
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
  const _ = useTranslation();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const {
    paragraphState,
    paragraphConfig,
    ttsSyncStatus,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
    reengageTtsFollow,
  } = useParagraphMode({ bookKey, viewRef });

  // One-time-per-session decouple toast: the first time following drops while
  // TTS still plays, tell the user once. Reset when following re-engages so a
  // later decouple notifies again.
  const decoupleToastShownRef = useRef(false);
  useEffect(() => {
    if (ttsSyncStatus === 'decoupled') {
      if (!decoupleToastShownRef.current) {
        decoupleToastShownRef.current = true;
        eventDispatcher.dispatch('toast', {
          message: _('Stopped following audio'),
          type: 'info',
        });
      }
    } else if (ttsSyncStatus === 'following') {
      decoupleToastShownRef.current = false;
    }
  }, [ttsSyncStatus, _]);

  if (!paragraphConfig?.enabled) {
    return null;
  }

  return (
    <>
      <ParagraphOverlay
        bookKey={bookKey}
        dimOpacity={DIM_OPACITY}
        viewSettings={viewSettings ?? undefined}
        gridInsets={gridInsets}
        ttsSyncStatus={ttsSyncStatus}
        onResumeTtsFollow={reengageTtsFollow}
        onClose={toggleParagraphMode}
      />
      <ParagraphBar
        bookKey={bookKey}
        currentIndex={paragraphState.currentIndex}
        totalParagraphs={paragraphState.totalParagraphs}
        isLoading={paragraphState.isLoading}
        onPrev={goToPrevParagraph}
        onNext={goToNextParagraph}
        onClose={toggleParagraphMode}
        viewSettings={viewSettings ?? undefined}
        gridInsets={gridInsets}
      />
    </>
  );
};

export default ParagraphControl;
