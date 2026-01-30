'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { RSVPController, RsvpStartChoice } from '@/services/rsvp';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from '@/hooks/useTranslation';
import RSVPOverlay from './RSVPOverlay';
import RSVPStartDialog from './RSVPStartDialog';

interface RSVPControlProps {
  bookKey: string;
}

const RSVPControl: React.FC<RSVPControlProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getView, getProgress, getViewSettings, setProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();

  const [isActive, setIsActive] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [startChoice, setStartChoice] = useState<RsvpStartChoice | null>(null);
  const controllerRef = useRef<RSVPController | null>(null);

  // Clean up controller on unmount
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.shutdown();
        controllerRef.current = null;
      }
    };
  }, []);

  // Listen for RSVP start events
  useEffect(() => {
    const handleRSVPStart = (event: CustomEvent) => {
      const { bookKey: rsvpBookKey, selectionText } = event.detail;
      if (bookKey !== rsvpBookKey) return;
      handleStart(selectionText);
    };

    const handleRSVPStop = (event: CustomEvent) => {
      const { bookKey: rsvpBookKey } = event.detail;
      if (bookKey !== rsvpBookKey) return;
      handleClose();
    };

    eventDispatcher.on('rsvp-start', handleRSVPStart);
    eventDispatcher.on('rsvp-stop', handleRSVPStop);

    return () => {
      eventDispatcher.off('rsvp-start', handleRSVPStart);
      eventDispatcher.off('rsvp-stop', handleRSVPStop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  const handleStart = useCallback(
    (selectionText?: string) => {
      const view = getView(bookKey);
      const bookData = getBookData(bookKey);
      const progress = getProgress(bookKey);

      if (!view || !bookData || !bookData.book) {
        eventDispatcher.dispatch('toast', {
          message: _('Unable to start RSVP'),
          type: 'error',
        });
        return;
      }

      // Check if format is supported (not PDF)
      if (bookData.book.format === 'PDF') {
        eventDispatcher.dispatch('toast', {
          message: _('RSVP not supported for PDF'),
          type: 'warning',
        });
        return;
      }

      // Create controller if not exists
      if (!controllerRef.current) {
        controllerRef.current = new RSVPController(view, bookKey);
      }

      const controller = controllerRef.current;

      // Set current CFI for position tracking
      if (progress?.location) {
        controller.setCurrentCfi(progress.location);
      }

      // Handle start choice event
      const handleStartChoice = (e: Event) => {
        const choice = (e as CustomEvent<RsvpStartChoice>).detail;
        setStartChoice(choice);

        // If there's only one option (beginning), start directly
        if (!choice.hasSavedPosition && !choice.hasSelection) {
          controller.startFromBeginning();
          setIsActive(true);
        } else {
          // Show dialog for user to choose
          setShowStartDialog(true);
        }
      };

      controller.addEventListener('rsvp-start-choice', handleStartChoice);
      controller.requestStart(selectionText);

      // Clean up listener after handling
      setTimeout(() => {
        controller.removeEventListener('rsvp-start-choice', handleStartChoice);
      }, 100);
    },
    [_, bookKey, getBookData, getProgress, getView],
  );

  const handleStartDialogSelect = useCallback(
    (option: 'beginning' | 'saved' | 'current' | 'selection') => {
      setShowStartDialog(false);
      const controller = controllerRef.current;
      if (!controller) return;

      switch (option) {
        case 'beginning':
          controller.startFromBeginning();
          break;
        case 'saved':
          controller.startFromSavedPosition();
          break;
        case 'current':
          controller.startFromCurrentPosition();
          break;
        case 'selection':
          if (startChoice?.selectionText) {
            controller.startFromSelection(startChoice.selectionText);
          }
          break;
      }
      setIsActive(true);
    },
    [startChoice],
  );

  const handleClose = useCallback(() => {
    const controller = controllerRef.current;
    if (controller) {
      controller.stop();
    }
    setIsActive(false);
    setShowStartDialog(false);
  }, []);

  const handleChapterSelect = useCallback(
    (href: string) => {
      const view = getView(bookKey);
      if (!view) return;

      // Navigate to chapter
      view.goTo(href);

      // Wait for navigation, then reload RSVP content
      setTimeout(() => {
        const controller = controllerRef.current;
        if (controller) {
          const progress = getProgress(bookKey);
          if (progress?.location) {
            controller.setCurrentCfi(progress.location);
          }
          controller.loadNextPageContent();
        }
      }, 500);
    },
    [bookKey, getProgress, getView],
  );

  const handleRequestNextPage = useCallback(() => {
    const view = getView(bookKey);
    if (!view) return;

    // Go to next page
    view.next();

    // Wait for page change, then load new content
    setTimeout(() => {
      const controller = controllerRef.current;
      if (controller) {
        const progress = getProgress(bookKey);
        if (progress?.location) {
          controller.setCurrentCfi(progress.location);
        }
        controller.loadNextPageContent();
      }
    }, 500);
  }, [bookKey, getProgress, getView]);

  // Get current chapter info
  const progress = getProgress(bookKey);
  const bookData = getBookData(bookKey);
  const chapters = bookData?.bookDoc?.toc || [];
  const currentChapterHref = progress?.sectionHref || null;

  // Use portal to render overlay at body level to avoid stacking context issues
  const portalContainer = typeof document !== 'undefined' ? document.body : null;

  return (
    <>
      {/* Start dialog - render via portal */}
      {showStartDialog && startChoice && portalContainer &&
        createPortal(
          <RSVPStartDialog
            startChoice={startChoice}
            onSelect={handleStartDialogSelect}
            onClose={() => setShowStartDialog(false)}
          />,
          portalContainer
        )}

      {/* RSVP Overlay - render via portal */}
      {isActive && controllerRef.current && portalContainer &&
        createPortal(
          <RSVPOverlay
            controller={controllerRef.current}
            chapters={chapters}
            currentChapterHref={currentChapterHref}
            onClose={handleClose}
            onChapterSelect={handleChapterSelect}
            onRequestNextPage={handleRequestNextPage}
          />,
          portalContainer
        )}
    </>
  );
};

export default RSVPControl;
