import React, { useState, useEffect, useCallback } from 'react';
import { FiSearch } from 'react-icons/fi';
import { FiCopy } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { FaWikipediaW } from 'react-icons/fa';
import { BsPencilSquare } from 'react-icons/bs';
import { RiDeleteBinLine } from 'react-icons/ri';
import { BsTranslate } from 'react-icons/bs';
import { TbHexagonLetterD } from 'react-icons/tb';
import { FaHeadphones } from 'react-icons/fa6';
import { MdBuildCircle } from 'react-icons/md';

import * as CFI from 'foliate-js/epubcfi.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { useEnv } from '@/context/EnvContext';
import { BookNote, BooknoteGroup, HighlightColor, HighlightStyle } from '@/types/book';
import { getOSPlatform, uniqueId } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useFoliateEvents } from '../../hooks/useFoliateEvents';
import { useNotesSync } from '../../hooks/useNotesSync';
import { useTextSelector } from '../../hooks/useTextSelector';
import { getPopupPosition, getPosition, Position, TextSelection } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { findTocItemBS } from '@/utils/toc';
import { throttle } from '@/utils/throttle';
import { runSimpleCC } from '@/utils/simplecc';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { addReplacementRule } from '@/services/transformers/replacement';
import AnnotationPopup from './AnnotationPopup';
import WiktionaryPopup from './WiktionaryPopup';
import WikipediaPopup from './WikipediaPopup';
import TranslatorPopup from './TranslatorPopup';
import useShortcuts from '@/hooks/useShortcuts';
import ReplacementOptions from './ReplacementOptions';

import { isWordLimitExceeded } from '@/utils/wordLimit';

const Annotator: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById, getViewSettings } = useReaderStore();
  const { setNotebookVisible, setNotebookNewAnnotation } = useNotebookStore();

  useNotesSync(bookKey);

  const osPlatform = getOSPlatform();
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey)!;
  const bookData = getBookData(bookKey)!;
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;

  const containerRef = React.useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [showAnnotPopup, setShowAnnotPopup] = useState(false);
  const [showWiktionaryPopup, setShowWiktionaryPopup] = useState(false);
  const [showWikipediaPopup, setShowWikipediaPopup] = useState(false);
  const [showDeepLPopup, setShowDeepLPopup] = useState(false);
  const [showReplacementOptions, setShowReplacementOptions] = useState(false);
  const [trianglePosition, setTrianglePosition] = useState<Position>();
  const [annotPopupPosition, setAnnotPopupPosition] = useState<Position>();
  const [dictPopupPosition, setDictPopupPosition] = useState<Position>();
  const [translatorPopupPosition, setTranslatorPopupPosition] = useState<Position>();
  const [highlightOptionsVisible, setHighlightOptionsVisible] = useState(false);

  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>(
    settings.globalReadSettings.highlightStyle,
  );
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(
    settings.globalReadSettings.highlightStyles[selectedStyle],
  );

  const popupPadding = useResponsiveSize(10);
  const maxWidth = window.innerWidth - 2 * popupPadding;
  const maxHeight = window.innerHeight - 2 * popupPadding;
  const dictPopupWidth = Math.min(480, maxWidth);
  const dictPopupHeight = Math.min(300, maxHeight);
  const transPopupWidth = Math.min(480, maxWidth);
  const transPopupHeight = Math.min(265, maxHeight);
  const annotPopupWidth = Math.min(useResponsiveSize(300), maxWidth);
  const annotPopupHeight = useResponsiveSize(44);
  const androidSelectionHandlerHeight = 0;

  // Reposition popups on scroll without dismissing them
  const repositionPopups = useCallback(() => {
    if (!selection || !selection.text) return;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const triangPos = getPosition(selection.range, rect, popupPadding, viewSettings.vertical);
    const annotPopupPos = getPopupPosition(
      triangPos,
      rect,
      viewSettings.vertical ? annotPopupHeight : annotPopupWidth,
      viewSettings.vertical ? annotPopupWidth : annotPopupHeight,
      popupPadding,
    );
    if (annotPopupPos.dir === 'down' && osPlatform === 'android') {
      triangPos.point.y += androidSelectionHandlerHeight;
      annotPopupPos.point.y += androidSelectionHandlerHeight;
    }
    const dictPopupPos = getPopupPosition(
      triangPos,
      rect,
      dictPopupWidth,
      dictPopupHeight,
      popupPadding,
    );
    const transPopupPos = getPopupPosition(
      triangPos,
      rect,
      transPopupWidth,
      transPopupHeight,
      popupPadding,
    );
    if (triangPos.point.x == 0 || triangPos.point.y == 0) return;
    setAnnotPopupPosition(annotPopupPos);
    setDictPopupPosition(dictPopupPos);
    setTranslatorPopupPosition(transPopupPos);
    setTrianglePosition(triangPos);
  }, [
    selection,
    bookKey,
    osPlatform,
    popupPadding,
    viewSettings.vertical,
    annotPopupHeight,
    annotPopupWidth,
    dictPopupWidth,
    dictPopupHeight,
    transPopupWidth,
    transPopupHeight,
  ]);

  useEffect(() => {
    setSelectedStyle(settings.globalReadSettings.highlightStyle);
  }, [settings.globalReadSettings.highlightStyle]);

  useEffect(() => {
    setSelectedColor(settings.globalReadSettings.highlightStyles[selectedStyle]);
  }, [settings.globalReadSettings.highlightStyles, selectedStyle]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleDismissPopup = useCallback(
    throttle(() => {
      setSelection(null);
      setShowAnnotPopup(false);
      setShowWiktionaryPopup(false);
      setShowWikipediaPopup(false);
      setShowDeepLPopup(false);
      setShowReplacementOptions(false);
    }, 500),
    [],
  );

  const handleDismissPopupAndSelection = () => {
    handleDismissPopup();
    view?.deselect();
  };

  const {
    handleScroll,
    handleTouchStart,
    handleTouchEnd,
    handlePointerdown,
    handlePointerup,
    handleSelectionchange,
    handleShowPopup,
    handleUpToPopup,
    handleContextmenu,
  } = useTextSelector(bookKey, setSelection, handleDismissPopup);

  const onLoad = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { doc, index } = detail;

    const handleTouchmove = () => {
      // Available on iOS, on Android not fired
      // To make the popup not follow the selection while dragging
      setShowAnnotPopup(false);
    };

    // Attach generic selection listeners for all formats, including PDF.
    // For PDF we only guarantee Copy & Translate; highlight/annotate may be limited by CFI support.
    view?.renderer?.addEventListener('scroll', handleScroll);
    // Reposition popups on scroll to keep them in view
    view?.renderer?.addEventListener('scroll', () => {
      repositionPopups();
    });
    detail.doc?.addEventListener('touchstart', handleTouchStart);
    detail.doc?.addEventListener('touchmove', handleTouchmove);
    detail.doc?.addEventListener('touchend', handleTouchEnd);
    detail.doc?.addEventListener('pointerdown', handlePointerdown);
    detail.doc?.addEventListener('pointerup', (ev: PointerEvent) =>
      handlePointerup(doc, index, ev),
    );
    detail.doc?.addEventListener('selectionchange', () => handleSelectionchange(doc, index));

    // For PDF selections, enable right-click context menu to directly open translator popup.
    if (bookData.book?.format === 'PDF') {
      detail.doc?.addEventListener('contextmenu', (e: Event) => {
        try {
          const sel = doc.getSelection?.();
          if (sel && !sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            const text = sel.toString();
            if (text.trim()) {
              setSelection({ key: bookKey, text, range, index });
              // Show translation popup preferentially for PDF right-click
              setShowAnnotPopup(false);
              setShowDeepLPopup(true);
              setShowWiktionaryPopup(false);
              setShowWikipediaPopup(false);
            }
          }
        } catch (err) {
          console.warn('PDF context menu translation failed:', err);
        }
        // Prevent native menu to keep experience consistent
        e.preventDefault();
        e.stopPropagation();
        return false;
      });
    }

    // Disable the default context menu on mobile devices (selection handles suffice)
    detail.doc?.addEventListener('contextmenu', handleContextmenu);
  };

  const onDrawAnnotation = (event: Event) => {
    const viewSettings = getViewSettings(bookKey)!;
    const detail = (event as CustomEvent).detail;
    const { draw, annotation, doc, range } = detail;
    const { style, color } = annotation as BookNote;
    const customColors = settings.globalReadSettings.customHighlightColors;
    const hexColor =
      color && customColors ? customColors[color] : color ? HIGHLIGHT_COLOR_HEX[color] : color;
    if (style === 'highlight') {
      draw(Overlayer.highlight, { color: hexColor });
    } else if (['underline', 'squiggly'].includes(style as string)) {
      const { defaultView } = doc;
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const { writingMode, lineHeight, fontSize } = defaultView.getComputedStyle(el);
      const lineHeightValue =
        parseFloat(lineHeight) || viewSettings.lineHeight * viewSettings.defaultFontSize;
      const fontSizeValue = parseFloat(fontSize) || viewSettings.defaultFontSize;
      const strokeWidth = 2;
      const padding = viewSettings.vertical
        ? (lineHeightValue - fontSizeValue - strokeWidth) / 2
        : strokeWidth;
      draw(Overlayer[style as keyof typeof Overlayer], { writingMode, color: hexColor, padding });
    }
  };

  const onShowAnnotation = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { value: cfi, index, range } = detail;
    const { booknotes = [] } = getConfig(bookKey)!;
    const annotations = booknotes.filter(
      (booknote) => booknote.type === 'annotation' && !booknote.deletedAt,
    );
    const annotation = annotations.find((annotation) => annotation.cfi === cfi);
    if (!annotation) return;
    const selection = { key: bookKey, annotated: true, text: annotation.text ?? '', range, index };
    setSelectedStyle(annotation.style!);
    setSelectedColor(annotation.color!);
    setSelection(selection);
    handleUpToPopup();
  };

  useFoliateEvents(view, { onLoad, onDrawAnnotation, onShowAnnotation });

  useEffect(() => {
    handleShowPopup(showAnnotPopup || showWiktionaryPopup || showWikipediaPopup || showDeepLPopup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnnotPopup, showWiktionaryPopup, showWikipediaPopup, showDeepLPopup]);

  // When popups are visible, update their positions on scroll events
  useEffect(() => {
    const view = getView(bookKey);
    if (!view?.renderer) return;
    const onScroll = () => {
      if (showAnnotPopup || showWiktionaryPopup || showWikipediaPopup || showDeepLPopup) {
        repositionPopups();
      }
    };
    view.renderer.addEventListener('scroll', onScroll);
    return () => {
      view.renderer.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookKey,
    showAnnotPopup,
    showWiktionaryPopup,
    showWikipediaPopup,
    showDeepLPopup,
    repositionPopups,
  ]);

  useEffect(() => {
    eventDispatcher.on('export-annotations', handleExportMarkdown);
    return () => {
      eventDispatcher.off('export-annotations', handleExportMarkdown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setHighlightOptionsVisible(!!(selection && selection.annotated));
    if (selection && selection.text.trim().length > 0) {
      const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
      if (!gridFrame) return;
      const rect = gridFrame.getBoundingClientRect();
      const triangPos = getPosition(selection.range, rect, popupPadding, viewSettings.vertical);
      const annotPopupPos = getPopupPosition(
        triangPos,
        rect,
        viewSettings.vertical ? annotPopupHeight : annotPopupWidth,
        viewSettings.vertical ? annotPopupWidth : annotPopupHeight,
        popupPadding,
      );
      if (annotPopupPos.dir === 'down' && osPlatform === 'android') {
        triangPos.point.y += androidSelectionHandlerHeight;
        annotPopupPos.point.y += androidSelectionHandlerHeight;
      }
      const dictPopupPos = getPopupPosition(
        triangPos,
        rect,
        dictPopupWidth,
        dictPopupHeight,
        popupPadding,
      );
      const transPopupPos = getPopupPosition(
        triangPos,
        rect,
        transPopupWidth,
        transPopupHeight,
        popupPadding,
      );
      if (triangPos.point.x == 0 || triangPos.point.y == 0) return;
      setAnnotPopupPosition(annotPopupPos);
      setDictPopupPosition(dictPopupPos);
      setTranslatorPopupPosition(transPopupPos);
      setTrianglePosition(triangPos);
      handleShowAnnotPopup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, bookKey]);

  useEffect(() => {
    if (!progress) return;
    const { location } = progress;
    const start = CFI.collapse(location);
    const end = CFI.collapse(location, true);
    const { booknotes = [] } = config;
    const annotations = booknotes.filter(
      (item) =>
        !item.deletedAt &&
        item.type === 'annotation' &&
        item.style &&
        CFI.compare(item.cfi, start) >= 0 &&
        CFI.compare(item.cfi, end) <= 0,
    );
    try {
      Promise.all(annotations.map((annotation) => view?.addAnnotation(annotation)));
    } catch (e) {
      console.warn(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const handleShowAnnotPopup = () => {
    if (!appService?.isMobile) {
      containerRef.current?.focus();
    }
    setShowAnnotPopup(true);
    setShowDeepLPopup(false);
    setShowWiktionaryPopup(false);
    setShowWikipediaPopup(false);
  };

  const handleCopy = (copyToNotebook = true) => {
    if (!selection || !selection.text) return;
    setTimeout(() => {
      // Delay to ensure it won't be overridden by system clipboard actions
      navigator.clipboard?.writeText(selection.text);
    }, 100);
    handleDismissPopupAndSelection();

    if (!copyToNotebook) return;

    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to notebook'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });

    const { booknotes: annotations = [] } = config;
    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return;
    const annotation: BookNote = {
      id: uniqueId(),
      type: 'excerpt',
      cfi,
      text: selection.text,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const existingIndex = annotations.findIndex(
      (annotation) =>
        annotation.cfi === cfi && annotation.type === 'excerpt' && !annotation.deletedAt,
    );
    if (existingIndex !== -1) {
      annotations[existingIndex] = annotation;
    } else {
      annotations.push(annotation);
    }
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
    if (!appService?.isMobile) {
      setNotebookVisible(true);
    }
  };

  const handleHighlight = (update = false, highlightStyle?: HighlightStyle) => {
    if (!selection || !selection.text) return;
    setHighlightOptionsVisible(true);
    const { booknotes: annotations = [] } = config;
    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return;
    const style = highlightStyle || settings.globalReadSettings.highlightStyle;
    const color = settings.globalReadSettings.highlightStyles[style];
    const annotation: BookNote = {
      id: uniqueId(),
      type: 'annotation',
      cfi,
      style,
      color,
      text: selection.text,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const existingIndex = annotations.findIndex(
      (annotation) =>
        annotation.cfi === cfi && annotation.type === 'annotation' && !annotation.deletedAt,
    );
    const views = getViewsById(bookKey.split('-')[0]!);
    if (existingIndex !== -1) {
      views.forEach((view) => view?.addAnnotation(annotation, true));
      if (update) {
        annotation.id = annotations[existingIndex]!.id;
        annotations[existingIndex] = annotation;
        views.forEach((view) => view?.addAnnotation(annotation));
      } else {
        annotations[existingIndex]!.deletedAt = Date.now();
        setShowAnnotPopup(false);
      }
    } else {
      annotations.push(annotation);
      views.forEach((view) => view?.addAnnotation(annotation));
      setSelection({ ...selection, annotated: true });
    }

    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };

  const handleAnnotate = () => {
    if (!selection || !selection.text) return;
    const { sectionHref: href } = progress;
    selection.href = href;
    handleHighlight(true);
    setNotebookVisible(true);
    setNotebookNewAnnotation(selection);
    handleDismissPopup();
  };

  const handleSearch = () => {
    if (!selection || !selection.text) return;
    handleDismissPopupAndSelection();

    let term = selection.text;
    const convertChineseVariant = viewSettings.convertChineseVariant;
    if (convertChineseVariant && convertChineseVariant !== 'none') {
      term = runSimpleCC(term, convertChineseVariant, true);
    }
    eventDispatcher.dispatch('search', { term });
  };

  const handleDictionary = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setShowWiktionaryPopup(true);
  };

  const handleWikipedia = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setShowWikipediaPopup(true);
  };

  const handleTranslation = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setShowDeepLPopup(true);
  };

  const handleSpeakText = async () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    eventDispatcher.dispatch('tts-speak', { bookKey, range: selection.range });
  };

  // Import type for ReplacementConfig
  type ReplacementConfig = {
    replacementText: string;
    caseSensitive: boolean;
    scope: 'once' | 'book' | 'library';
  };

  // Helper to check if selected text is a whole word (has word boundaries on both sides)
  // Updated to be more lenient: allows phrases and lines, only prevents partial word matches
  const isWholeWord = (range: Range, selectedText: string): boolean => {
    try {
      if (!selectedText || selectedText.trim().length === 0) return false;

      // Verify the selection contains word characters
      const hasWordCharInSelection = /[a-zA-Z0-9_]/.test(selectedText);
      if (!hasWordCharInSelection) {
        return false;
      }

      // If the selection contains spaces, punctuation, or multiple words, it's a phrase
      // Phrases (including lines with quotes) are always allowed for single-instance replacements
      const hasSpaces = /\s/.test(selectedText);
      const hasPunctuation = /[^\w\s]/.test(selectedText);
      const isPhrase = hasSpaces || hasPunctuation;

      // Also allow selections that start or end with punctuation (e.g., "'tis", "off;", "look,")
      // These are valid selections where the user intentionally includes punctuation
      const startsWithPunctuation = /^[^\w\s]/.test(selectedText);
      const endsWithPunctuation = /[^\w\s]$/.test(selectedText);
      const hasBoundaryPunctuation = startsWithPunctuation || endsWithPunctuation;

      if (isPhrase || hasBoundaryPunctuation) {
        // For phrases or selections with boundary punctuation, we allow them
        // The only thing we want to prevent is selecting "and" inside "England"
        return true;
      }

      // For single words, check boundaries to prevent partial word matches
      // Get characters immediately before and after the selection
      let charBefore = '';
      let charAfter = '';

      try {
        // Get character before
        const startNode = range.startContainer;
        if (startNode.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
          const textNode = startNode as Text;
          charBefore = textNode.textContent?.charAt(range.startOffset - 1) || '';
        } else if (startNode.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
          // Check previous sibling text node
          let prevSibling = startNode.previousSibling;
          while (prevSibling && prevSibling.nodeType !== Node.TEXT_NODE) {
            prevSibling = prevSibling.previousSibling;
          }
          if (prevSibling && prevSibling.nodeType === Node.TEXT_NODE) {
            const prevText = (prevSibling as Text).textContent || '';
            charBefore = prevText.charAt(prevText.length - 1);
          }
        }

        // Get character after
        const endNode = range.endContainer;
        if (endNode.nodeType === Node.TEXT_NODE) {
          const textNode = endNode as Text;
          const textContent = textNode.textContent || '';
          if (range.endOffset < textContent.length) {
            charAfter = textContent.charAt(range.endOffset);
          } else {
            // Check next sibling text node
            let nextSibling = textNode.nextSibling;
            while (nextSibling && nextSibling.nodeType !== Node.TEXT_NODE) {
              nextSibling = nextSibling.nextSibling;
            }
            if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
              const nextText = (nextSibling as Text).textContent || '';
              charAfter = nextText.charAt(0);
            }
          }
        }
      } catch (e) {
        // If we can't determine boundaries for a single word, be lenient
        // This handles edge cases with complex HTML
        console.warn('[isWholeWord] Error checking boundaries:', e);
        return true; // Allow if we can't verify (better to allow than reject valid selections)
      }

      // Word characters are: letters, digits, and underscore [a-zA-Z0-9_]
      const isWordChar = (char: string) => /[a-zA-Z0-9_]/.test(char);

      // Check boundaries for single words
      // Empty means we're at start/end of text (valid boundary)
      const hasBoundaryBefore = !charBefore || !isWordChar(charBefore);
      const hasBoundaryAfter = !charAfter || !isWordChar(charAfter);

      const isValid = hasBoundaryBefore && hasBoundaryAfter;

      if (!isValid) {
        console.log('[isWholeWord] Not a whole word:', {
          selectedText,
          charBefore: charBefore || '(start)',
          charAfter: charAfter || '(end)',
          hasBoundaryBefore,
          hasBoundaryAfter,
        });
      }

      return isValid;
    } catch (e) {
      console.warn('Failed to check whole word:', e);
      // On error, be lenient - allow selections with word characters
      // This prevents false rejections for complex selections (quotes, multi-node, etc.)
      return /[a-zA-Z0-9_]/.test(selectedText);
    }
  };

  // Helper to count which occurrence of a pattern was selected (using whole-word matching)
  const getOccurrenceIndex = (range: Range, pattern: string): number => {
    try {
      const doc = range.startContainer.ownerDocument;
      if (!doc || !doc.body) return 0;

      // Create a range from start of body to start of selection
      const beforeRange = doc.createRange();
      beforeRange.setStart(doc.body, 0);
      beforeRange.setEnd(range.startContainer, range.startOffset);

      // Get text before selection and count occurrences using whole-word matching
      const textBefore = beforeRange.toString();
      // Escape pattern and add word boundaries for whole-word matching
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wholeWordPattern = `\\b${escapedPattern}\\b`;
      const regex = new RegExp(wholeWordPattern, 'g');
      const matches = textBefore.match(regex);

      return matches ? matches.length : 0;
    } catch (e) {
      console.warn('Failed to get occurrence index:', e);
      return 0;
    }
  };

  const handleReplacementConfirm = async (config: ReplacementConfig) => {
    if (!selection || !selection.text) return;

    const { replacementText, caseSensitive, scope } = config;

    console.log('Replacement confirmed:', {
      originalText: selection.text,
      replacementText,
      caseSensitive,
      scope,
    });

    try {
      if (scope === 'once') {
        // For single-instance: direct DOM modification + persistent rule
        const range = selection.range;
        if (range) {
          // Validate that the selection is a whole word
          // Single-instance replacements only work on whole words to prevent
          // replacing substrings inside larger words (e.g., "and" in "England")
          const isValidWholeWord = isWholeWord(range, selection.text);

          if (!isValidWholeWord) {
            eventDispatcher.dispatch('toast', {
              type: 'warning',
              message: `Cannot replace "${selection.text}" - please select a complete word. Partial word selections (like "and" in "England" or "errand") are not supported.`,
              timeout: 5000,
            });
            return;
          }

          // Get which occurrence this is BEFORE modifying the DOM
          // Use whole-word matching to count occurrences correctly
          const occurrenceIndex = getOccurrenceIndex(range, selection.text);
          const sectionHref = progress?.sectionHref;

          // Directly modify DOM for immediate effect
          // Note: createTextNode automatically escapes HTML entities, so angle brackets will be preserved
          range.deleteContents();
          const textNode = document.createTextNode(replacementText);
          range.insertNode(textNode);

          // Create rule with occurrence tracking for persistence
          await addReplacementRule(
            envConfig,
            bookKey,
            {
              pattern: selection.text,
              replacement: replacementText,
              isRegex: false,
              enabled: true,
              caseSensitive,
              singleInstance: true,
              sectionHref,
              occurrenceIndex,
            },
            'single',
          );

          eventDispatcher.dispatch('toast', {
            type: 'success',
            message: 'Replacement applied! Will persist on refresh.',
            timeout: 3000,
          });

          setShowReplacementOptions(false);
          handleDismissPopupAndSelection();
        }
      } else {
        // For book-wide and global: use the transformer approach
        const backendScope = scope === 'book' ? 'book' : 'global';
        const range = selection.range;
        const isValidWholeWord = range ? isWholeWord(range, selection.text) : false;
        if (!isValidWholeWord) {
          eventDispatcher.dispatch('toast', {
            type: 'warning',
            message: `Cannot replace "${selection.text}" - please select a complete word. Partial word selections (like "and" in "England" or "errand") are not supported.`,
            timeout: 5000,
          });
          return;
        }
        await addReplacementRule(
          envConfig,
          bookKey,
          {
            pattern: selection.text,
            replacement: replacementText,
            isRegex: false,
            enabled: true,
            caseSensitive,
            singleInstance: false,
            wholeWord: true,
          },
          backendScope as 'book' | 'global',
        );

        const scopeLabels = {
          book: 'this book',
          library: 'your library',
        };

        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: `Replacement applied to ${scopeLabels[scope]}! Reloading...`,
          timeout: 3000,
        });

        setShowReplacementOptions(false);
        handleDismissPopupAndSelection();

        // Reload the book view to apply the replacement
        const { recreateViewer } = useReaderStore.getState();
        await recreateViewer(envConfig, bookKey);
      }
    } catch (error) {
      console.error('Failed to apply replacement:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: 'Failed to apply replacement. Please try again.',
        timeout: 3000,
      });
    }
  };

  const handleShowReplacementOptions = () => {
    if (!selection || !selection.text) {
      return;
    }

    if (isWordLimitExceeded(selection.text)) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: 'Word limit exceeded. Please select 30 words or fewer.',
        timeout: 3000,
      });
      return;
    }

    setShowReplacementOptions(!showReplacementOptions);
  };

  // Keyboard shortcuts: trigger actions only if there's an active selection and popup hidden
  useShortcuts(
    {
      onHighlightSelection: () => {
        handleHighlight(false, 'highlight');
      },
      onUnderlineSelection: () => {
        handleHighlight(false, 'underline');
      },
      onAnnotateSelection: () => {
        handleAnnotate();
      },
      onSearchSelection: () => {
        handleSearch();
      },
      onCopySelection: () => {
        handleCopy(false);
      },
      onTranslateSelection: () => {
        handleTranslation();
      },
      onDictionarySelection: () => {
        handleDictionary();
      },
      onWikipediaSelection: () => {
        handleWikipedia();
      },
      onReadAloudSelection: () => {
        handleSpeakText();
      },
    },
    [selection?.text],
  );

  const handleExportMarkdown = (event: CustomEvent) => {
    const { bookKey: exportBookKey } = event.detail;
    if (bookKey !== exportBookKey) return;

    const { bookDoc, book } = bookData;
    if (!bookDoc || !book || !bookDoc.toc) return;

    const config = getConfig(bookKey)!;
    const { booknotes: allNotes = [] } = config;
    const booknotes = allNotes.filter((note) => !note.deletedAt);
    if (booknotes.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No annotations to export'),
        className: 'whitespace-nowrap',
        timeout: 2000,
      });
      return;
    }
    const booknoteGroups: { [href: string]: BooknoteGroup } = {};
    for (const booknote of booknotes) {
      const tocItem = findTocItemBS(bookDoc.toc ?? [], booknote.cfi);
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

    const lines: string[] = [];
    lines.push(`# ${book.title}`);
    lines.push(`**${_('Author')}**: ${book.author || ''}`);
    lines.push('');
    lines.push(`**${_('Exported from Readest')}**: ${new Date().toISOString().slice(0, 10)}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`## ${_('Highlights & Annotations')}`);
    lines.push('');

    for (const group of sortedGroups) {
      const chapterTitle = group.label || _('Untitled');
      lines.push(`### ${chapterTitle}`);
      for (const note of group.booknotes) {
        lines.push(`> "${note.text}"`);
        if (note.note) {
          lines.push(`**${_('Note')}**:: ${note.note}`);
        }
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    const markdownContent = lines.join('\n');

    navigator.clipboard?.writeText(markdownContent);
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
    if (appService?.isMobile) return;
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectionAnnotated = selection?.annotated;
  const buttons = [
    { tooltipText: _('Copy'), Icon: FiCopy, onClick: handleCopy },
    {
      tooltipText: selectionAnnotated ? _('Delete Highlight') : _('Highlight'),
      Icon: selectionAnnotated ? RiDeleteBinLine : PiHighlighterFill,
      onClick: handleHighlight,
      disabled: bookData.book?.format === 'PDF',
    },
    {
      tooltipText: _('Annotate'),
      Icon: BsPencilSquare,
      onClick: handleAnnotate,
      disabled: bookData.book?.format === 'PDF',
    },
    {
      tooltipText: _('Search'),
      Icon: FiSearch,
      onClick: handleSearch,
      disabled: bookData.book?.format === 'PDF',
    },
    { tooltipText: _('Dictionary'), Icon: TbHexagonLetterD, onClick: handleDictionary },
    { tooltipText: _('Wikipedia'), Icon: FaWikipediaW, onClick: handleWikipedia },
    { tooltipText: _('Translate'), Icon: BsTranslate, onClick: handleTranslation },
    {
      tooltipText: _('Speak'),
      Icon: FaHeadphones,
      onClick: handleSpeakText,
      disabled: bookData.book?.format === 'PDF',
    },
    {
      tooltipText: 'Text Replacement',
      Icon: MdBuildCircle,
      onClick: handleShowReplacementOptions,
      disabled: bookData.book?.format !== 'EPUB',
    },
  ];

  return (
    <div ref={containerRef} role='toolbar' tabIndex={-1}>
      {showWiktionaryPopup && trianglePosition && dictPopupPosition && (
        <WiktionaryPopup
          word={selection?.text as string}
          lang={bookData.bookDoc?.metadata.language as string}
          position={dictPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={dictPopupWidth}
          popupHeight={dictPopupHeight}
          onDismiss={handleDismissPopupAndSelection}
        />
      )}
      {showWikipediaPopup && trianglePosition && dictPopupPosition && (
        <WikipediaPopup
          text={selection?.text as string}
          lang={bookData.bookDoc?.metadata.language as string}
          position={dictPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={dictPopupWidth}
          popupHeight={dictPopupHeight}
          onDismiss={handleDismissPopupAndSelection}
        />
      )}
      {showDeepLPopup && trianglePosition && translatorPopupPosition && (
        <TranslatorPopup
          text={selection?.text as string}
          position={translatorPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={transPopupWidth}
          popupHeight={transPopupHeight}
          onDismiss={handleDismissPopupAndSelection}
        />
      )}
      {showAnnotPopup && trianglePosition && annotPopupPosition && (
        <AnnotationPopup
          dir={viewSettings.rtl ? 'rtl' : 'ltr'}
          isVertical={viewSettings.vertical}
          buttons={buttons}
          position={annotPopupPosition}
          trianglePosition={trianglePosition}
          highlightOptionsVisible={highlightOptionsVisible}
          selectedStyle={selectedStyle}
          selectedColor={selectedColor}
          popupWidth={annotPopupWidth}
          popupHeight={annotPopupHeight}
          onHighlight={handleHighlight}
          onDismiss={handleDismissPopupAndSelection}
        />
      )}
      {showReplacementOptions && trianglePosition && annotPopupPosition && (
        <ReplacementOptions
          isVertical={viewSettings.vertical}
          style={{
            height: 'auto',
            left: `${annotPopupPosition.point.x}px`,
            top: `${
              annotPopupPosition.point.y +
              (annotPopupHeight + 16) * (trianglePosition.dir === 'up' ? -1 : 1)
            }px`,
          }}
          selectedText={selection?.text || ''}
          onConfirm={handleReplacementConfirm}
          onClose={() => setShowReplacementOptions(false)}
        />
      )}
    </div>
  );
};

export default Annotator;
