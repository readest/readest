import React, { useState, useEffect, useCallback } from 'react';
import { RiDeleteBinLine } from 'react-icons/ri';

import * as CFI from 'foliate-js/epubcfi.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { useEnv } from '@/context/EnvContext';
import { BookNote, BooknoteGroup, HighlightColor, HighlightStyle } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';
import { NativeTouchEventType } from '@/types/system';
import { getOSPlatform, uniqueId } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useFoliateEvents } from '../../hooks/useFoliateEvents';
import { useNotesSync } from '../../hooks/useNotesSync';
import { useTextSelector } from '../../hooks/useTextSelector';
import { getPopupPosition, getPosition, Position, TextSelection } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { findTocItemBS } from '@/utils/toc';
import { throttle } from '@/utils/throttle';
import { runSimpleCC } from '@/utils/simplecc';
import { getWordCount } from '@/utils/word';
import { getHighlightColorHex } from '../../utils/annotatorUtil';
import { annotationToolButtons } from './AnnotationTools';
import AnnotationPopup from './AnnotationPopup';
import WiktionaryPopup from './WiktionaryPopup';
import WikipediaPopup from './WikipediaPopup';
import TranslatorPopup from './TranslatorPopup';
import useShortcuts from '@/hooks/useShortcuts';
import ProofreadPopup from './ProofreadPopup';

const Annotator: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById, getViewSettings } = useReaderStore();
  const { setNotebookVisible, setNotebookNewAnnotation } = useNotebookStore();
  const { listenToNativeTouchEvents } = useDeviceControlStore();

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
  const [showProofreadPopup, setShowProofreadPopup] = useState(false);
  const [trianglePosition, setTrianglePosition] = useState<Position>();
  const [annotPopupPosition, setAnnotPopupPosition] = useState<Position>();
  const [dictPopupPosition, setDictPopupPosition] = useState<Position>();
  const [translatorPopupPosition, setTranslatorPopupPosition] = useState<Position>();
  const [proofreadPopupPosition, setProofreadPopupPosition] = useState<Position>();
  const [highlightOptionsVisible, setHighlightOptionsVisible] = useState(false);
  const [showAnnotationNotes, setShowAnnotationNotes] = useState(false);
  const [annotationNotes, setAnnotationNotes] = useState<BookNote[]>([]);

  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>(
    settings.globalReadSettings.highlightStyle,
  );
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(
    settings.globalReadSettings.highlightStyles[selectedStyle],
  );

  const popupPadding = useResponsiveSize(10);
  const trianglePadding = popupPadding * 2 + 6;
  const maxWidth = window.innerWidth - 2 * popupPadding;
  const maxHeight = window.innerHeight - 2 * popupPadding;
  const dictPopupWidth = Math.min(480, maxWidth);
  const dictPopupHeight = Math.min(300, maxHeight);
  const transPopupWidth = Math.min(480, maxWidth);
  const transPopupHeight = Math.min(265, maxHeight);
  const proofreadPopupWidth = Math.min(440, maxWidth);
  const proofreadPopupHeight = Math.min(200, maxHeight);
  const annotPopupWidth = Math.min(useResponsiveSize(300), maxWidth);
  const annotPopupHeight = useResponsiveSize(44);
  const androidSelectionHandlerHeight = 0;

  // Reposition popups on scroll without dismissing them
  const repositionPopups = useCallback(() => {
    if (!selection || !selection.text) return;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const triangPos = getPosition(selection, rect, trianglePadding, viewSettings.vertical);
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
    const proofreadPopupPos = getPopupPosition(
      triangPos,
      rect,
      proofreadPopupWidth,
      proofreadPopupHeight,
      popupPadding,
    );
    if (triangPos.point.x == 0 || triangPos.point.y == 0) return;
    setAnnotPopupPosition(annotPopupPos);
    setDictPopupPosition(dictPopupPos);
    setTranslatorPopupPosition(transPopupPos);
    setProofreadPopupPosition(proofreadPopupPos);
    setTrianglePosition(triangPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, bookKey, viewSettings.vertical]);

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
      setShowProofreadPopup(false);
    }, 500),
    [],
  );

  const {
    isTextSelected,
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

  const handleDismissPopupAndSelection = () => {
    handleDismissPopup();
    view?.deselect();
    isTextSelected.current = false;
  };

  const onLoad = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { doc, index } = detail;

    const handleTouchmove = () => {
      // Available on iOS, on Android not fired
      // To make the popup not follow the selection while dragging
      setShowAnnotPopup(false);
    };

    const handleNativeTouch = (event: CustomEvent) => {
      const ev = event.detail as NativeTouchEventType;
      if (ev.type === 'touchstart') {
        handleTouchStart();
      } else if (ev.type === 'touchend') {
        handleTouchEnd();
        handlePointerup(doc, index);
      }
    };

    if (appService?.isAndroidApp) {
      listenToNativeTouchEvents();
      eventDispatcher.on('native-touch', handleNativeTouch);
    }

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
    detail.doc?.addEventListener('selectionchange', () => handleSelectionchange(doc));

    // For PDF selections, enable right-click context menu to directly open translator popup.
    if (bookData.book?.format === 'PDF') {
      detail.doc?.addEventListener('contextmenu', (e: Event) => {
        try {
          const sel = doc.getSelection?.();
          if (sel && !sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            const text = sel.toString();
            if (text.trim()) {
              setSelection({ key: bookKey, text, range, index, cfi: view?.getCFI(index, range) });
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
    const hexColor = getHighlightColorHex(settings, color);
    if (annotation.note) {
      const { defaultView } = doc;
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const { writingMode } = defaultView.getComputedStyle(el);
      draw(Overlayer.bubble, { writingMode });
    } else if (style === 'highlight') {
      draw(Overlayer.highlight, { color: hexColor });
    } else if (['underline', 'squiggly'].includes(style as string)) {
      const { defaultView } = doc;
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const { writingMode, lineHeight, fontSize } = defaultView.getComputedStyle(el);
      const fontSizeValue = parseFloat(fontSize) || viewSettings.defaultFontSize;
      const lineHeightValue = parseFloat(lineHeight) || viewSettings.lineHeight * fontSizeValue;
      const strokeWidth = 2;
      const verticalCompensation = appService?.isMobile ? 0 : -1;
      const horizontalCompensation = appService?.isMobile ? -1 : 0;
      const padding = viewSettings.vertical
        ? (lineHeightValue - fontSizeValue) / 2 - strokeWidth + verticalCompensation
        : (lineHeightValue - fontSizeValue) / 2 - strokeWidth + horizontalCompensation;
      draw(Overlayer[style as keyof typeof Overlayer], { writingMode, color: hexColor, padding });
    }
  };

  const onShowAnnotation = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { value, index, range } = detail;
    const { booknotes = [] } = getConfig(bookKey)!;
    const isNote = value.startsWith(NOTE_PREFIX);
    const cfi = isNote ? value.replace(NOTE_PREFIX, '') : value;
    const annotations = booknotes.filter(
      (booknote) => booknote.type === 'annotation' && !booknote.deletedAt && booknote.cfi === cfi,
    );
    const annotation = annotations.find(
      (annotation) => (!isNote && annotation.style) || (isNote && annotation.note),
    );
    if (!annotation) return;

    const { style, color, text, note } = annotation;
    const selection = {
      key: bookKey,
      annotated: true,
      text: text ?? '',
      note: note ?? '',
      rect: isNote ? detail.rect : undefined,
      cfi,
      range,
      index,
    };
    if (isNote) {
      setShowAnnotationNotes(true);
      setHighlightOptionsVisible(false);
    } else {
      setShowAnnotationNotes(false);
      setAnnotationNotes([]);
      if (style && color) {
        setSelectedStyle(style);
        setSelectedColor(color);
      }
    }
    setSelection(selection);
    handleUpToPopup();
  };

  useFoliateEvents(view, { onLoad, onDrawAnnotation, onShowAnnotation });

  useEffect(() => {
    handleShowPopup(
      showAnnotPopup ||
        showWiktionaryPopup ||
        showWikipediaPopup ||
        showDeepLPopup ||
        showProofreadPopup,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnnotPopup, showWiktionaryPopup, showWikipediaPopup, showDeepLPopup, showProofreadPopup]);

  // When popups are visible, update their positions on scroll events
  useEffect(() => {
    const view = getView(bookKey);
    if (!view?.renderer) return;
    const onScroll = () => {
      if (
        showAnnotPopup ||
        showWiktionaryPopup ||
        showWikipediaPopup ||
        showDeepLPopup ||
        showProofreadPopup
      ) {
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
    showProofreadPopup,
    repositionPopups,
  ]);

  useEffect(() => {
    eventDispatcher.on('export-annotations', handleExportMarkdown);
    return () => {
      eventDispatcher.off('export-annotations', handleExportMarkdown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickAction = () => {
    const action = viewSettings.annotationQuickAction;
    switch (action) {
      case 'copy':
        handleCopy(false);
        handleDismissPopupAndSelection();
        break;
      case 'highlight':
        // Delay to ensure highlight is applied after selection is set
        // so that onShowAnnotation won't be triggered immediately
        setTimeout(() => {
          handleHighlight();
          handleDismissPopupAndSelection();
        }, 0);
        break;
      case 'dictionary':
        handleDictionary();
        break;
      case 'wikipedia':
        handleWikipedia();
        break;
      case 'translate':
        handleTranslation();
        break;
      case 'tts':
        handleSpeakText(true);
        break;
    }
  };

  useEffect(() => {
    setHighlightOptionsVisible(!!(selection && selection.annotated));
    if (selection && selection.text.trim().length > 0) {
      const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
      if (!gridFrame) return;
      const rect = gridFrame.getBoundingClientRect();
      const triangPos = getPosition(selection, rect, trianglePadding, viewSettings.vertical);
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
      const proofreadPopupPos = getPopupPosition(
        triangPos,
        rect,
        proofreadPopupWidth,
        proofreadPopupHeight,
        popupPadding,
      );
      if (triangPos.point.x == 0 || triangPos.point.y == 0) return;
      setAnnotPopupPosition(annotPopupPos);
      setDictPopupPosition(dictPopupPos);
      setTranslatorPopupPosition(transPopupPos);
      setProofreadPopupPosition(proofreadPopupPos);
      setTrianglePosition(triangPos);

      const { enableAnnotationQuickActions, annotationQuickAction } = viewSettings;
      if (enableAnnotationQuickActions && annotationQuickAction && isTextSelected.current) {
        handleQuickAction();
      } else {
        handleShowAnnotPopup();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.cfi, bookKey]);

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
    const notes = booknotes.filter(
      (item) =>
        !item.deletedAt &&
        item.type === 'annotation' &&
        item.note &&
        item.note.trim().length > 0 &&
        CFI.compare(item.cfi, start) >= 0 &&
        CFI.compare(item.cfi, end) <= 0,
    );
    try {
      Promise.all(annotations.map((annotation) => view?.addAnnotation(annotation)));
      Promise.all(
        notes.map((note) => view?.addAnnotation({ ...note, value: `${NOTE_PREFIX}${note.cfi}` })),
      );
    } catch (e) {
      console.warn(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (!config.booknotes || !selection?.cfi || !showAnnotationNotes) return;
    const annotations = config.booknotes.filter(
      (booknote) =>
        booknote.type === 'annotation' && !booknote.deletedAt && booknote.cfi === selection.cfi,
    );
    const notes = annotations.filter((item) => item.note && item.note.trim().length > 0);
    setAnnotationNotes(notes);
  }, [selection?.cfi, showAnnotationNotes, config.booknotes]);

  const handleShowAnnotPopup = () => {
    if (!appService?.isMobile) {
      containerRef.current?.focus();
    }
    setShowAnnotPopup(true);
    setShowDeepLPopup(false);
    setShowWiktionaryPopup(false);
    setShowWikipediaPopup(false);
  };

  const handleCopy = (dismissPopup = true) => {
    if (!selection || !selection.text) return;
    setTimeout(() => {
      // Delay to ensure it won't be overridden by system clipboard actions
      navigator.clipboard?.writeText(selection.text);
    }, 100);
    if (dismissPopup) {
      handleDismissPopupAndSelection();
    }

    if (!viewSettings?.copyToNotebook) return;

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
        annotation.cfi === cfi &&
        annotation.type === 'annotation' &&
        annotation.style &&
        !annotation.deletedAt,
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
      setSelection({ ...selection, cfi, annotated: true });
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

  const handleSpeakText = async (oneTime = false) => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    eventDispatcher.dispatch('tts-speak', { bookKey, range: selection.range, oneTime });
  };

  const handleProofread = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setShowProofreadPopup(true);

    if (getWordCount(selection.text) > 30) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Word limit of 30 words exceeded.'),
        timeout: 3000,
      });
      return;
    }
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
      onProofreadSelection: () => {
        handleProofread();
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
  const toolButtons = annotationToolButtons.map(({ type, label, Icon }) => {
    switch (type) {
      case 'copy':
        return { tooltipText: _(label), Icon, onClick: handleCopy };
      case 'highlight':
        return {
          tooltipText: selectionAnnotated ? _('Delete Highlight') : _(label),
          Icon: selectionAnnotated ? RiDeleteBinLine : Icon,
          onClick: handleHighlight,
          disabled: bookData.book?.format === 'PDF',
        };
      case 'annotate':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleAnnotate,
          disabled: bookData.book?.format === 'PDF',
        };
      case 'search':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleSearch,
          disabled: bookData.book?.format === 'PDF',
        };
      case 'dictionary':
        return { tooltipText: _(label), Icon, onClick: handleDictionary };
      case 'wikipedia':
        return { tooltipText: _(label), Icon, onClick: handleWikipedia };
      case 'translate':
        return { tooltipText: _(label), Icon, onClick: handleTranslation };
      case 'tts':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleSpeakText,
          disabled: bookData.book?.format === 'PDF',
        };
      case 'proofread':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleProofread,
          disabled: bookData.book?.format !== 'EPUB',
        };
      default:
        return { tooltipText: '', Icon, onClick: () => {} };
    }
  });

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
          bookKey={bookKey}
          dir={viewSettings.rtl ? 'rtl' : 'ltr'}
          isVertical={viewSettings.vertical}
          buttons={toolButtons}
          notes={annotationNotes}
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
      {showProofreadPopup && trianglePosition && proofreadPopupPosition && selection && (
        <ProofreadPopup
          bookKey={bookKey}
          selection={selection}
          position={proofreadPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={proofreadPopupWidth}
          popupHeight={proofreadPopupHeight}
          onDismiss={handleDismissPopupAndSelection}
        />
      )}
    </div>
  );
};

export default Annotator;
