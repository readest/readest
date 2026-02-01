'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useThemeStore } from '@/store/themeStore';
import { RSVPController, RsvpStartChoice, RsvpStopPosition } from '@/services/rsvp';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote } from '@/types/book';
import RSVPOverlay from './RSVPOverlay';
import RSVPStartDialog from './RSVPStartDialog';

interface RSVPControlProps {
  bookKey: string;
}

// Helper to expand a range to include the full sentence
const expandRangeToSentence = (range: Range, doc: Document): Range => {
  const sentenceRange = doc.createRange();

  // Get the text content around the range
  const container = range.commonAncestorContainer;
  const parentElement =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);

  if (!parentElement) return range;

  // Get the full text of the parent paragraph/element
  const fullText = parentElement.textContent || '';
  const rangeText = range.toString();

  // Find the position of our word in the parent text
  const wordStart = fullText.indexOf(rangeText);
  if (wordStart === -1) return range;

  // Find sentence boundaries (. ! ? or start/end of text)
  const sentenceEnders = /[.!?]/g;
  let sentenceStart = 0;
  let sentenceEnd = fullText.length;

  // Find the sentence start (look backwards for sentence ender)
  for (let i = wordStart - 1; i >= 0; i--) {
    if (sentenceEnders.test(fullText[i]!)) {
      sentenceStart = i + 1;
      // Skip any whitespace after the sentence ender
      while (sentenceStart < fullText.length && /\s/.test(fullText[sentenceStart]!)) {
        sentenceStart++;
      }
      break;
    }
  }

  // Find the sentence end (look forward for sentence ender)
  for (let i = wordStart; i < fullText.length; i++) {
    if (sentenceEnders.test(fullText[i]!)) {
      sentenceEnd = i + 1;
      break;
    }
  }

  // Create a tree walker to find the text nodes
  const walker = doc.createTreeWalker(parentElement, NodeFilter.SHOW_TEXT, null);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const nodeLength = node.textContent?.length || 0;

    if (!startNode && currentOffset + nodeLength > sentenceStart) {
      startNode = node;
      startOffset = sentenceStart - currentOffset;
    }

    if (currentOffset + nodeLength >= sentenceEnd) {
      endNode = node;
      endOffset = sentenceEnd - currentOffset;
      break;
    }

    currentOffset += nodeLength;
  }

  if (startNode && endNode) {
    try {
      sentenceRange.setStart(startNode, Math.max(0, startOffset));
      sentenceRange.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length || 0));
      return sentenceRange;
    } catch {
      return range;
    }
  }

  return range;
};

const RSVPControl: React.FC<RSVPControlProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getView, getProgress, getViewSettings, setProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const { themeCode } = useThemeStore();

  const [isActive, setIsActive] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [startChoice, setStartChoice] = useState<RsvpStartChoice | null>(null);
  const controllerRef = useRef<RSVPController | null>(null);
  const tempHighlightRef = useRef<BookNote | null>(null);

  // Helper to remove any existing RSVP highlight
  const removeRsvpHighlight = useCallback(() => {
    const view = getView(bookKey);
    if (tempHighlightRef.current && view) {
      try {
        view.addAnnotation(tempHighlightRef.current, true);
      } catch {
        // Ignore errors when removing
      }
    }
    tempHighlightRef.current = null;
  }, [bookKey, getView]);

  // Clean up controller and highlight on unmount
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.shutdown();
        controllerRef.current = null;
      }
      // Remove any existing RSVP highlight when component unmounts
      removeRsvpHighlight();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Remove any existing RSVP highlight when starting new session
      removeRsvpHighlight();

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
    [_, bookKey, getBookData, getProgress, getView, removeRsvpHighlight],
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
    const view = getView(bookKey);

    if (controller && view) {
      // Listen for the stop event to get the position
      const handleRsvpStop = (e: Event) => {
        const stopPosition = (e as CustomEvent<RsvpStopPosition | null>).detail;

        if (stopPosition?.range && typeof stopPosition.docIndex === 'number') {
          try {
            // Get the document from the renderer
            const contents = view.renderer.getContents?.();
            const content = contents?.find((c) => c.index === stopPosition.docIndex);
            const doc = content?.doc;

            if (doc && stopPosition.range) {
              // Expand the range to include the full sentence
              const sentenceRange = expandRangeToSentence(stopPosition.range, doc);

              // Get CFI for navigation - MUST get this BEFORE navigating
              const cfi = view.getCFI(stopPosition.docIndex, stopPosition.range);

              // Get CFI for the sentence highlight - MUST get this BEFORE navigating
              // because goTo() may re-render the document, invalidating the Range objects
              const sentenceCfi = cfi ? view.getCFI(stopPosition.docIndex, sentenceRange) : null;
              const sentenceText = sentenceRange.toString();

              if (cfi) {
                // Navigate to the position
                view.goTo(cfi);

                if (sentenceCfi) {
                  // Remove any previous RSVP highlight
                  removeRsvpHighlight();

                  // Create a persistent highlight for the sentence using theme accent color
                  const highlight: BookNote = {
                    id: `rsvp-temp-${Date.now()}`,
                    type: 'annotation',
                    cfi: sentenceCfi,
                    text: sentenceText,
                    style: 'underline',
                    color: themeCode.primary, // Use theme accent color (same as ORP focal point)
                    note: '',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  };

                  tempHighlightRef.current = highlight;
                  view.addAnnotation(highlight);
                  // Note: highlight persists until next page, reader close, or new RSVP session
                }
              }
            }
          } catch (err) {
            console.warn('Failed to sync RSVP position:', err);
          }
        }
      };

      controller.addEventListener('rsvp-stop', handleRsvpStop);
      controller.stop();
      controller.removeEventListener('rsvp-stop', handleRsvpStop);
    } else if (controller) {
      controller.stop();
    }

    setIsActive(false);
    setShowStartDialog(false);
  }, [bookKey, getView, removeRsvpHighlight, themeCode.primary]);

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

  const handleRequestNextPage = useCallback(async () => {
    const view = getView(bookKey);
    if (!view) return;

    // Remove RSVP highlight when moving to next page
    removeRsvpHighlight();

    // RSVP extracts ALL words from the current section via renderer.getContents().
    // When RSVP runs out of words and calls this function, it means the entire
    // chapter/section has been read, so we need to go to the next section.
    await view.renderer.nextSection?.();

    // Wait for section change, then load new content
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
  }, [bookKey, getProgress, getView, removeRsvpHighlight]);

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
      {showStartDialog &&
        startChoice &&
        portalContainer &&
        createPortal(
          <RSVPStartDialog
            startChoice={startChoice}
            onSelect={handleStartDialogSelect}
            onClose={() => setShowStartDialog(false)}
          />,
          portalContainer,
        )}

      {/* RSVP Overlay - render via portal */}
      {isActive &&
        controllerRef.current &&
        portalContainer &&
        createPortal(
          <RSVPOverlay
            controller={controllerRef.current}
            chapters={chapters}
            currentChapterHref={currentChapterHref}
            onClose={handleClose}
            onChapterSelect={handleChapterSelect}
            onRequestNextPage={handleRequestNextPage}
          />,
          portalContainer,
        )}
    </>
  );
};

export default RSVPControl;
