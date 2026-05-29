import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RiDeleteBinLine } from 'react-icons/ri';

import * as CFI from 'foliate-js/epubcfi.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { useEnv } from '@/context/EnvContext';
import { BookNote, BooknoteGroup, HighlightColor, HighlightStyle } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';
import { NativeTouchEventType } from '@/types/system';
import { getLocale, getOSPlatform, makeSafeFilename, uniqueId } from '@/utils/misc';
import { useThemeStore } from '@/store/themeStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { isSystemDictionaryEnabled } from '@/services/dictionaries/registry';
import { invokeSystemDictionary } from '@/services/dictionaries/systemDictionary';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useFoliateEvents } from '../../hooks/useFoliateEvents';
import { useNotesSync } from '../../hooks/useNotesSync';
import { useReadwiseSync } from '../../hooks/useReadwiseSync';
import { useHardcoverSync } from '../../hooks/useHardcoverSync';
import { useTextSelector } from '../../hooks/useTextSelector';
import { Point, Position, TextSelection } from '@/utils/sel';
import {
  getPopupPosition,
  getPosition,
  getRangeRectInWebview,
  getRangeTextStyleInWebview,
  getTextFromRange,
} from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { findTocItemBS } from '@/services/nav';
import { throttle } from '@/utils/throttle';
import {
  cancelDeferredAction,
  createDeferredActionState,
  flushDeferredAction,
  runOrDeferAction,
} from '../../utils/deferredAction';
import { runSimpleCC } from '@/utils/simplecc';
import { getWordCount } from '@/utils/word';
import { getIndexFromCfi, isCfiInLocation } from '@/utils/cfi';
import { TransformContext } from '@/services/transformers/types';
import { transformContent } from '@/services/transformService';
import { getHighlightColorHex, removeBookNoteOverlays } from '../../utils/annotatorUtil';
import {
  expandAllRenderedSections,
  expandGlobalAnnotation,
  isSyntheticGlobalValue,
  removeGlobalAnnotationOverlays,
  sourceCfiFromSyntheticValue,
} from '../../utils/globalAnnotations';
import { annotationToolButtons } from './AnnotationTools';
import { DEFAULT_ANNOTATION_TOOL_TYPES } from '@/types/annotator';
import {
  INLINE_INSIGHT_UNDERLINE_COLOR,
  InlineInsightSnapshot,
  isInlineInsightAnnotation,
  isRegularTextAnnotation,
  isUserBookNote,
  upsertInlineInsightAnnotation,
} from '@/services/inlineInsight/annotations';
import AnnotationRangeEditor from './AnnotationRangeEditor';
import AnnotationPopup from './AnnotationPopup';
import DictionaryPopup from './DictionaryPopup';
import DictionarySheet from './DictionarySheet';
import TranslatorPopup from './TranslatorPopup';
import useShortcuts from '@/hooks/useShortcuts';
import ProofreadPopup from './ProofreadPopup';
import InlineInsightPopup from './InlineInsightPopup';
import { setProofreadRulesVisibility } from '@/app/reader/components/ProofreadRules';
import ExportMarkdownDialog from './ExportMarkdownDialog';
import Alert from '@/components/Alert';
import ModalPortal from '@/components/ModalPortal';
import { useFileSelector } from '@/hooks/useFileSelector';
import { parseMrexpt } from '@/utils/mrexpt';
import {
  convertMrexptEntriesToBookNotes,
  mergeImportedBookNotes,
} from '@/services/annotation/providers/mrexpt';

const Annotator: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettingsDialogBookKey, setSettingsDialogOpen, setActiveSettingsItemId } =
    useSettingsStore();
  const { isDarkMode } = useThemeStore();
  const { getConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById, getViewSettings } = useReaderStore();
  const { setNotebookVisible, setNotebookNewAnnotation } = useNotebookStore();
  const { clearBooknotesNav } = useSidebarStore();
  const { listenToNativeTouchEvents } = useDeviceControlStore();
  const { loadCustomDictionaries } = useCustomDictionaryStore();
  const { selectFiles } = useFileSelector(appService, _);

  useNotesSync(bookKey);
  useReadwiseSync(bookKey);
  useHardcoverSync(bookKey);

  useEffect(() => {
    void loadCustomDictionaries(envConfig).catch((error) => {
      console.warn('Failed to load custom dictionaries:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const osPlatform = getOSPlatform();
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey)!;
  const bookData = getBookData(bookKey)!;
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const primaryLang = bookData.book?.primaryLanguage || 'en';

  const containerRef = React.useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [showAnnotPopup, setShowAnnotPopup] = useState(false);
  const [showDictionaryPopup, setShowDictionaryPopup] = useState(false);
  const [showDeepLPopup, setShowDeepLPopup] = useState(false);
  const [showProofreadPopup, setShowProofreadPopup] = useState(false);
  const [showInlineInsightPopup, setShowInlineInsightPopup] = useState(false);
  const [trianglePosition, setTrianglePosition] = useState<Position>();
  const [annotPopupPosition, setAnnotPopupPosition] = useState<Position>();
  const [dictPopupPosition, setDictPopupPosition] = useState<Position>();
  const [translatorPopupPosition, setTranslatorPopupPosition] = useState<Position>();
  const [proofreadPopupPosition, setProofreadPopupPosition] = useState<Position>();
  const [highlightOptionsVisible, setHighlightOptionsVisible] = useState(false);
  const [showAnnotationNotes, setShowAnnotationNotes] = useState(false);
  const [annotationNotes, setAnnotationNotes] = useState<BookNote[]>([]);
  const [editingAnnotation, setEditingAnnotation] = useState<BookNote | null>(null);
  const [externalDragPoint, setExternalDragPoint] = useState<Point | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  // "Clear Annotations" confirm dialog. Hosted here (and not in BookMenu)
  // because the menu unmounts the moment the user picks the entry, which
  // would otherwise tear down the dialog state immediately.
  const [clearAnnotationsCount, setClearAnnotationsCount] = useState(0);
  const [exportData, setExportData] = useState<{
    booknotes: BookNote[];
    booknoteGroups: { [href: string]: BooknoteGroup };
  } | null>(null);
  const [inlineInsightSnapshot, setInlineInsightSnapshot] = useState<InlineInsightSnapshot | null>(
    null,
  );

  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>(
    settings.globalReadSettings.highlightStyle,
  );
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(
    settings.globalReadSettings.highlightStyles[selectedStyle],
  );
  const androidTouchEndRef = useRef(false);
  // Holds a quick action that fired while the user is still touching the screen
  // (Android long-press selects text via selectionchange before touchend). The
  // pending action runs on touchend so popups don't open under an active touch.
  const deferredQuickActionRef = useRef(createDeferredActionState());

  const showingPopup =
    showAnnotPopup ||
    showDictionaryPopup ||
    showDeepLPopup ||
    showProofreadPopup ||
    showInlineInsightPopup;

  const popupPadding = useResponsiveSize(10);
  const trianglePadding = popupPadding * 2 + 6;
  const maxWidth = window.innerWidth - 2 * popupPadding;
  const maxHeight = window.innerHeight - 2 * popupPadding;
  const dictPopupWidth = Math.min(480, maxWidth);
  // Tall enough to fit a header + 2-3 expanded cards comfortably. The popup
  // shows all enabled providers stacked (no tabs) so it needs more vertical
  // room than the legacy single-tab layout.
  const dictPopupHeight = Math.min(360, maxHeight);
  const transPopupWidth = Math.min(480, maxWidth);
  const transPopupHeight = Math.min(265, maxHeight);
  const proofreadPopupWidth = Math.min(440, maxWidth);
  const proofreadPopupHeight = Math.min(200, maxHeight);
  const enabledAnnotationToolTypes = viewSettings.annotationToolbarButtons?.length
    ? viewSettings.annotationToolbarButtons
    : DEFAULT_ANNOTATION_TOOL_TYPES;
  const enabledAnnotationToolTypeSet = useMemo(
    () => new Set(enabledAnnotationToolTypes),
    [enabledAnnotationToolTypes],
  );
  const visibleAnnotationToolButtons = useMemo(
    () => annotationToolButtons.filter((button) => enabledAnnotationToolTypeSet.has(button.type)),
    [enabledAnnotationToolTypeSet],
  );
  const annotPopupWidth = Math.min(
    useResponsiveSize(Math.max(visibleAnnotationToolButtons.length, 1) * 36),
    maxWidth,
  );
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
    const highlightStyle = settings.globalReadSettings.highlightStyle;
    setSelectedStyle(highlightStyle);
    setSelectedColor(settings.globalReadSettings.highlightStyles[highlightStyle]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.globalReadSettings.highlightStyle]);

  const transformCtx: TransformContext = useMemo(
    () => ({
      bookKey,
      viewSettings: getViewSettings(bookKey)!,
      userLocale: getLocale(),
      content: '',
      isFixedLayout: bookData.isFixedLayout,
      transformers: ['punctuation'],
      reversePunctuationTransform: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const getAnnotationText = useCallback(
    async (range: Range) => {
      transformCtx['content'] = getTextFromRange(range, ['rt']);
      return await transformContent(transformCtx);
    },
    [primaryLang, transformCtx],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleDismissPopup = useCallback(
    throttle(() => {
      setSelection(null);
      setShowAnnotPopup(false);
      setShowDictionaryPopup(false);
      setShowDeepLPopup(false);
      setShowProofreadPopup(false);
      setShowInlineInsightPopup(false);
      setEditingAnnotation(null);
    }, 500),
    [],
  );

  const {
    isTextSelected,
    isInstantAnnotating,
    handleScroll,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handlePointerDown,
    handlePointerMove,
    handlePointerCancel,
    handlePointerUp,
    handleSelectionchange,
    handleShowPopup,
    handleUpToPopup,
    handleContextmenu,
  } = useTextSelector(
    bookKey,
    setSelection,
    setEditingAnnotation,
    setExternalDragPoint,
    getAnnotationText,
    handleDismissPopup,
  );

  const handleDismissPopupAndSelection = () => {
    handleDismissPopup();
    view?.deselect();
    isTextSelected.current = false;
  };

  const onLoad = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { doc, index } = detail;

    const handleTouchmove = (ev: TouchEvent) => {
      // Available on iOS, on Android not fired
      // To make the popup not follow the selection while dragging
      setShowAnnotPopup(false);
      if (!isInstantAnnotating.current) {
        setEditingAnnotation(null);
      }
      handleTouchMove(ev);
    };

    const handleNativeTouch = (event: CustomEvent) => {
      const ev = event.detail as NativeTouchEventType;
      if (ev.type === 'touchstart') {
        androidTouchEndRef.current = false;
        cancelDeferredAction(deferredQuickActionRef.current);
        handleTouchStart();
      } else if (ev.type === 'touchend') {
        androidTouchEndRef.current = true;
        handleTouchEnd();
        handlePointerUp(doc, index);
        flushDeferredAction(deferredQuickActionRef.current);
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
    const opts = { passive: false };
    detail.doc?.addEventListener('touchstart', handleTouchStart, opts);
    detail.doc?.addEventListener('touchmove', handleTouchmove, opts);
    detail.doc?.addEventListener('touchend', handleTouchEnd);
    detail.doc?.addEventListener('pointerdown', handlePointerDown.bind(null, doc, index), opts);
    detail.doc?.addEventListener('pointermove', handlePointerMove.bind(null, doc, index), opts);
    detail.doc?.addEventListener('pointercancel', handlePointerCancel.bind(null, doc, index));
    detail.doc?.addEventListener('pointerup', handlePointerUp.bind(null, doc, index));
    detail.doc?.addEventListener('selectionchange', handleSelectionchange.bind(null, doc, index));

    // For PDF selections, enable right-click context menu to directly open translator popup.
    if (bookData.isFixedLayout) {
      detail.doc?.addEventListener('contextmenu', (e: Event) => {
        try {
          const sel = doc.getSelection?.();
          if (sel && !sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            const text = sel.toString();
            if (text.trim()) {
              setSelection({
                key: bookKey,
                text,
                range,
                index,
                cfi: view?.getCFI(index, range),
                page: index + 1,
              });
              // Show translation popup preferentially for PDF right-click
              setShowAnnotPopup(false);
              setShowDeepLPopup(true);
              setShowDictionaryPopup(false);
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

  const onCreateOverlay = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { booknotes = [] } = getConfig(bookKey)!;
    // Resolve the live (doc, overlayer) pair for this section so we can
    // fan out global annotations across every text-occurrence in it.
    const sectionContent = view?.renderer?.getContents().find((c) => c.index === detail.index) as
      | { doc?: Document; index?: number }
      | undefined;
    const sectionDoc = sectionContent?.doc;

    const activeAnnotations = booknotes.filter((b) => b.type === 'annotation' && !b.deletedAt);

    // 1. Draw native overlays only for notes whose anchor (cfi) lives
    //    inside this section — same as before.
    activeAnnotations
      .filter((booknote) => getIndexFromCfi(booknote.cfi) === detail.index)
      .map((annotation) => {
        try {
          view?.addAnnotation(annotation);
        } catch (err) {
          console.warn('Failed to add annotation', { annotation, error: err });
        }
      });

    // 2. Fan out every `global` annotation in this newly-rendered
    //    section, regardless of which section originally anchored it.
    //    `expandGlobalAnnotation` already skips the home anchor when the
    //    synthetic CFI collides with `note.cfi`.
    if (sectionDoc) {
      for (const annotation of activeAnnotations) {
        if (!annotation.global) continue;
        try {
          expandGlobalAnnotation(view ?? null, annotation, sectionDoc, detail.index);
        } catch (err) {
          console.warn('Failed to expand global annotation', { annotation, error: err });
        }
      }
    }
  };

  const onDrawAnnotation = (event: Event) => {
    const viewSettings = getViewSettings(bookKey)!;
    const isBwEink = viewSettings.isEink && !viewSettings.isColorEink;
    const detail = (event as CustomEvent).detail;
    const { draw, annotation, doc, range } = detail;
    const bookNote = annotation as BookNote;
    const { style, color } = bookNote;
    const isInlineInsight = isInlineInsightAnnotation(bookNote);
    const hexColor = isInlineInsight
      ? INLINE_INSIGHT_UNDERLINE_COLOR
      : getHighlightColorHex(settings, color);
    const einkBgColor = isDarkMode ? '#000000' : '#ffffff';
    const einkFgColor = isDarkMode ? '#ffffff' : '#000000';
    if (annotation.note) {
      const { defaultView } = doc;
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const { writingMode } = defaultView.getComputedStyle(el);
      draw(Overlayer.bubble, { writingMode });
    } else if (style === 'highlight') {
      draw(Overlayer.highlight, {
        color: isBwEink ? einkBgColor : hexColor,
        vertical: viewSettings.vertical,
      });
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
      draw(Overlayer[style as keyof typeof Overlayer], {
        writingMode,
        color: isBwEink ? einkFgColor : hexColor,
        width: isInlineInsight ? 1 : undefined,
        padding,
      });
    }
  };

  const onShowAnnotation = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { value, index, range } = detail;
    const { booknotes = [] } = getConfig(bookKey)!;
    const isNote = value.startsWith(NOTE_PREFIX);
    const rawValue = isNote ? value.replace(NOTE_PREFIX, '') : value;
    // A click on a fan-out copy of a global annotation reports a
    // synthetic value (`${cfi}#g${i}`); map it back to the source
    // booknote so the popup behaves identically to clicking the
    // original anchor.
    const cfi = isSyntheticGlobalValue(rawValue) ? sourceCfiFromSyntheticValue(rawValue) : rawValue;
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
      index,
      range,
      page: annotation.page || progress.page,
    };
    if (isNote) {
      setShowAnnotationNotes(true);
      setHighlightOptionsVisible(false);
      setEditingAnnotation(null);
    } else if (isInlineInsightAnnotation(annotation)) {
      if (isTextSelected.current) return;
      setShowAnnotPopup(false);
      setShowAnnotationNotes(false);
      setEditingAnnotation(null);
      setInlineInsightSnapshot(annotation.inlineInsight ?? null);
      setShowInlineInsightPopup(true);
    } else {
      setShowAnnotPopup(false);
      setEditingAnnotation(null);
      setShowAnnotationNotes(false);
      setAnnotationNotes([]);
      if (style && color) {
        setSelectedStyle(style);
        setSelectedColor(color);
      }
      if (style && range) {
        setEditingAnnotation(annotation);
      }
    }
    setSelection(selection);
    handleUpToPopup();
  };

  useFoliateEvents(view, { onLoad, onCreateOverlay, onDrawAnnotation, onShowAnnotation });

  useEffect(() => {
    handleShowPopup(showingPopup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingPopup]);

  // When popups are visible, update their positions on scroll events
  useEffect(() => {
    const view = getView(bookKey);
    if (!view?.renderer) return;
    const onScroll = () => {
      if (showingPopup) {
        repositionPopups();
      }
    };
    view.renderer.addEventListener('scroll', onScroll);
    return () => {
      view.renderer.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, showingPopup, repositionPopups]);

  useEffect(() => {
    eventDispatcher.on('export-annotations', handleExportMarkdown);
    eventDispatcher.on('clear-annotations', handleClearAnnotations);
    eventDispatcher.on('import-mrexpt', handleImportMrexpt);
    return () => {
      eventDispatcher.off('export-annotations', handleExportMarkdown);
      eventDispatcher.off('clear-annotations', handleClearAnnotations);
      eventDispatcher.off('import-mrexpt', handleImportMrexpt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const updateBooknotesPage = async () => {
      const config = getConfig(bookKey);
      const view = getView(bookKey);
      if (!config || !view) return;
      const { booknotes: annotations = [] } = config;
      annotations.sort((a, b) => {
        return CFI.compare(a.cfi, b.cfi);
      });
      for (const annotation of annotations) {
        if (annotation.deletedAt || annotation.page || !annotation.cfi) continue;
        const progress = await view.getCFIProgress(annotation.cfi);
        if (progress) {
          annotation.page = progress.location.current + 1;
        }
      }
      const updatedConfig = updateBooknotes(bookKey, annotations);
      if (updatedConfig) {
        saveConfig(envConfig, bookKey, updatedConfig, settings);
      }
    };
    setTimeout(updateBooknotesPage, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickAction = () => {
    const action = viewSettings.annotationQuickAction;
    const runAction = () => {
      switch (action) {
        case 'copy':
          handleCopy(false);
          handleDismissPopupAndSelection();
          break;
        case 'highlight':
          // highlight is already applied in instant annotating
          handleDismissPopupAndSelection();
          break;
        case 'search':
          handleSearch();
          break;
        case 'dictionary':
          handleDictionary();
          break;
        case 'translate':
          handleTranslation();
          break;
        case 'tts':
          handleSpeakText(true);
          break;
      }
    };
    // On Android, a long-press fires selectionchange (and this handler) while
    // the finger is still down. Defer until touchend so popups aren't dismissed
    // by the in-progress touch (closes #3935).
    runOrDeferAction(
      deferredQuickActionRef.current,
      !!appService?.isAndroidApp && !androidTouchEndRef.current,
      runAction,
    );
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
  }, [selection, bookKey]);

  useEffect(() => {
    if (!progress) return;
    const { location } = progress;
    const { booknotes = [] } = config;
    const annotations = booknotes.filter(
      (item) =>
        !item.deletedAt &&
        item.type === 'annotation' &&
        item.style &&
        isCfiInLocation(item.cfi, location),
    );
    const notes = booknotes.filter(
      (item) =>
        !item.deletedAt &&
        item.type === 'annotation' &&
        item.note &&
        item.note.trim().length > 0 &&
        isCfiInLocation(item.cfi, location),
    );
    try {
      Promise.all(annotations.map((annotation) => view?.addAnnotation(annotation)));
      Promise.all(
        notes.map((note) => view?.addAnnotation({ ...note, value: `${NOTE_PREFIX}${note.cfi}` })),
      );
      // Fan-out for any annotation flagged `global`. Semantics is
      // book-wide, so we don't filter by `location` here: every note
      // with `global=true` gets expanded across every section that
      // happens to be rendered right now. Sections rendered later are
      // covered by `onCreateOverlay`.
      const globalAnnotations = booknotes.filter(
        (item) => !item.deletedAt && item.type === 'annotation' && item.style && item.global,
      );
      for (const annotation of globalAnnotations) {
        if (view) expandAllRenderedSections(view, annotation);
      }
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
    setShowDictionaryPopup(false);
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
      note: '',
      text: selection.text,
      page: selection.page,
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
    setSelectedStyle(style);
    setSelectedColor(color);
    const annotation: BookNote = {
      id: uniqueId(),
      type: 'annotation',
      cfi,
      style,
      color,
      text: selection.text,
      note: '',
      page: progress.page,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const existingIndex = annotations.findIndex(
      (annotation) => annotation.cfi === cfi && isRegularTextAnnotation(annotation),
    );
    const views = getViewsById(bookKey.split('-')[0]!);
    if (existingIndex !== -1) {
      const existing = annotations[existingIndex]!;
      // Tear down both the original anchor and any global fan-outs that
      // were drawn for the previous style/color, so the redraw below
      // doesn't end up overlaying two highlights at the same position.
      views.forEach((view) => view?.addAnnotation(existing, true));
      if (existing.global) {
        views.forEach((view) => removeGlobalAnnotationOverlays(view, existing));
      }
      if (update) {
        annotation.id = existing.id;
        // Carry the existing `global` flag forward — toggling color/style
        // shouldn't silently demote a global highlight back to single-range.
        if (existing.global) annotation.global = true;
        annotations[existingIndex] = annotation;
        views.forEach((view) => view?.addAnnotation(annotation));
        if (annotation.global) {
          views.forEach((view) => {
            if (view) expandAllRenderedSections(view, annotation);
          });
        }
      } else {
        existing.deletedAt = Date.now();
        handleDismissPopup();
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

  /**
   * Toggle the `global` flag on the annotation currently anchored at
   * `selection.cfi`. When enabling, fan out overlays for every other
   * occurrence of `selection.text` in the same section; when disabling,
   * tear them down. The original anchor highlight at `cfi` is left
   * untouched in either direction.
   *
   * Hidden for fixed-layout formats (PDF/CBZ) because they don't expose
   * a per-section text DOM we can scan.
   */
  const handleToggleGlobal = () => {
    if (!selection || !selection.cfi || !selection.text) return;
    if (bookData.isFixedLayout) return;
    const { booknotes: annotations = [] } = config;
    const idx = annotations.findIndex(
      (a) => a.type === 'annotation' && a.style && !a.deletedAt && a.cfi === selection.cfi,
    );
    if (idx === -1) return;
    const existing = annotations[idx]!;
    const nextGlobal = !existing.global;
    annotations[idx] = { ...existing, global: nextGlobal, updatedAt: Date.now() };
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }

    const views = getViewsById(bookKey.split('-')[0]!);
    if (nextGlobal) {
      const updated = annotations[idx]!;
      views.forEach((v) => {
        if (v) expandAllRenderedSections(v, updated);
      });
    } else {
      views.forEach((v) => removeGlobalAnnotationOverlays(v, existing));
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
    eventDispatcher.dispatch('search-term', { term, bookKey });
  };

  const handleDictionary = () => {
    if (!selection || !selection.text) return;
    // System-dictionary path: when the user has opted in via Settings →
    // Languages → Dictionaries, hand the selection to the OS instead of
    // opening the in-app popup. Exclusivity is enforced at the store
    // level (enabling system disables everything else and vice versa),
    // so a single check on the system flag is sufficient.
    const dictSettings = useCustomDictionaryStore.getState().settings;
    if (isSystemDictionaryEnabled(dictSettings)) {
      // Build the macOS HUD anchor: the selection rect (so the HUD
      // appears at the original word) and the underlying paragraph's
      // text style (so AppKit re-draws the small label at the same
      // font size / colour as the original, matching the system
      // right-click → Look Up presentation).
      const rect = selection.range ? getRangeRectInWebview(selection.range) : null;
      const style = selection.range ? getRangeTextStyleInWebview(selection.range) : null;
      void invokeSystemDictionary(
        selection.text,
        rect ? { rect, style: style ?? undefined } : undefined,
      );
      handleDismissPopupAndSelection();
      return;
    }
    setShowAnnotPopup(false);
    setShowDictionaryPopup(true);
  };

  const handleTranslation = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setShowDeepLPopup(true);
  };

  const handleSpeakText = async (oneTime = false) => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setEditingAnnotation(null);
    eventDispatcher.dispatch('tts-speak', {
      bookKey,
      oneTime,
      range: selection.range,
      index: selection.index,
    });
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

  const handleInlineInsight = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    setInlineInsightSnapshot(null);
    setShowInlineInsightPopup(true);
  };

  const handleInlineInsightAnswerReady = useCallback(
    (responseAnswer: string, context: string) => {
      if (!selection || !selection.text) return;
      const cfi = selection.cfi || view?.getCFI(selection.index, selection.range);
      if (!cfi) return;

      const { booknotes: annotations = [] } = config;
      const { annotation, previousAnnotation, updatedAnnotations } = upsertInlineInsightAnnotation(
        annotations,
        selection,
        cfi,
        {
          answer: responseAnswer,
          context,
        },
      );
      const views = getViewsById(bookKey.split('-')[0]!);
      if (previousAnnotation) {
        views.forEach((view) => view?.addAnnotation(previousAnnotation, true));
      }
      views.forEach((view) => view?.addAnnotation(annotation));
      const updatedConfig = updateBooknotes(bookKey, updatedAnnotations);
      if (updatedConfig) {
        saveConfig(envConfig, bookKey, updatedConfig, settings);
      }
    },
    [
      bookKey,
      config,
      envConfig,
      getViewsById,
      saveConfig,
      selection,
      settings,
      updateBooknotes,
      view,
    ],
  );

  const handleStartEditAnnotation = useCallback(() => {
    setShowAnnotPopup(false);
  }, []);

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
      onReadAloudSelection: () => {
        handleSpeakText();
      },
      onProofreadSelection: () => {
        handleProofread();
      },
    },
    [selection?.text],
  );

  const handleImportMrexpt = async (event: CustomEvent) => {
    const { bookKey: importBookKey } = event.detail;
    if (bookKey !== importBookKey) return;

    const { bookDoc } = bookData;
    if (!bookDoc) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Book is not ready yet, please try again.'),
        timeout: 2000,
      });
      return;
    }

    // Pick the .mrexpt file.
    const result = await selectFiles({
      type: 'generic',
      accept: '.mrexpt,text/plain',
      extensions: ['mrexpt', 'txt'],
      multiple: false,
      dialogTitle: _('Select Moon+ Reader Export File'),
    });
    if (result.error || result.files.length === 0) return;
    const selectedFile = result.files[0]!;

    // Read the file content as text on both Web (File) and Tauri (path).
    let content = '';
    try {
      if (selectedFile.file) {
        content = await selectedFile.file.text();
      } else if (selectedFile.path) {
        content = (await appService?.readFile(selectedFile.path, 'None', 'text')) as string;
      }
    } catch (e) {
      console.warn('Failed to read mrexpt file:', e);
    }

    if (!content) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Failed to read the selected file.'),
        timeout: 2000,
      });
      return;
    }

    const entries = parseMrexpt(content);
    if (entries.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No annotations found in the file.'),
        timeout: 2000,
      });
      return;
    }

    let conversion;
    try {
      conversion = await convertMrexptEntriesToBookNotes(entries, bookDoc, {
        highlightStyle: settings.globalReadSettings.highlightStyle,
        highlightColor:
          settings.globalReadSettings.highlightStyles[settings.globalReadSettings.highlightStyle],
      });
    } catch (e) {
      console.warn('Failed to convert mrexpt entries:', e);
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Failed to import annotations.'),
        timeout: 3000,
      });
      return;
    }

    if (conversion.notes.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No annotations could be located in this book.'),
        timeout: 2500,
      });
      return;
    }

    // Merge into the current book config, deduplicating by note id and
    // preferring the latest updatedAt for any conflicting entries.
    const config = getConfig(bookKey)!;
    const { merged, applied, added, updated } = mergeImportedBookNotes(
      config.booknotes ?? [],
      conversion.notes,
    );
    const updatedConfig = updateBooknotes(bookKey, merged);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }

    // Apply imported (or resurrected) annotations to all live views so
    // they appear immediately. We only re-draw the notes that actually
    // changed in this round, otherwise duplicate addAnnotation calls
    // can confuse the overlay layer.
    const views = getViewsById(bookKey.split('-')[0]!);
    for (const note of applied) {
      try {
        views.forEach((v) => v?.addAnnotation(note));
      } catch (err) {
        console.warn('Failed to add imported annotation', { note, err });
      }
    }

    // A single result toast: the count if anything changed, otherwise a
    // plain "nothing new" hint for a repeated import of the same file.
    const imported = added + updated;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message:
        imported > 0
          ? _('Imported {{count}} annotations', { count: imported })
          : _('No new annotations to import'),
      timeout: 2500,
    });
  };

  const handleExportMarkdown = async (event: CustomEvent) => {
    const { bookKey: exportBookKey } = event.detail;
    if (bookKey !== exportBookKey) return;

    const { bookDoc, book } = bookData;
    if (!bookDoc || !book) return;

    const config = getConfig(bookKey)!;
    const { booknotes: allNotes = [] } = config;
    const booknotes = allNotes.filter((note) => !note.deletedAt && isUserBookNote(note));
    if (booknotes.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No annotations to export'),
        className: 'whitespace-nowrap',
        timeout: 2000,
      });
      return;
    }

    // Organize booknotes into groups by chapter
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

    setExportData({ booknotes, booknoteGroups });
    setShowExportDialog(true);
  };

  const handleConfirmExport = async (
    content: string,
    isPlainText: boolean,
    sharePosition?: { x: number; y: number; preferredEdge?: 'top' | 'bottom' | 'left' | 'right' },
  ) => {
    const { book } = bookData;
    if (!book) return;

    setTimeout(() => {
      // Delay to ensure it won't be overridden by system clipboard actions
      navigator.clipboard?.writeText(content);
    }, 100);

    const ext = isPlainText ? 'txt' : 'md';
    const mimeType = isPlainText ? 'text/plain' : 'text/markdown';
    const filename = `${makeSafeFilename(book.title)}.${ext}`;
    const saved = await appService?.saveFile(filename, content, {
      mimeType,
      share: true,
      sharePosition,
    });

    if (appService?.isMacOSApp) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: saved ? _('Exported successfully') : _('Copied to clipboard'),
      timeout: 2000,
    });
  };

  const handleCancelExport = () => {
    setShowExportDialog(false);
    setExportData(null);
  };

  // Show the confirm dialog when the BookMenu fires "clear-annotations"
  // for this book. We snapshot the count up-front so the dialog shows a
  // stable number even if `getConfig` updates underneath us.
  const handleClearAnnotations = (event: CustomEvent) => {
    const { bookKey: targetBookKey } = event.detail;
    if (bookKey !== targetBookKey) return;
    const cfg = getConfig(bookKey);
    const count = (cfg?.booknotes ?? []).filter(
      (n) => n.type === 'annotation' && !n.deletedAt,
    ).length;
    if (count === 0) return;
    setClearAnnotationsCount(count);
  };

  // Soft-delete every type='annotation' booknote on the active book by
  // stamping `deletedAt`. Bookmarks and excerpts are intentionally left
  // alone — they live in distinct sidebar tabs.
  const performClearAnnotations = () => {
    const latestConfig = getConfig(bookKey);
    if (!latestConfig) return;
    const { booknotes: storedNotes = [] } = latestConfig;
    const now = Date.now();
    const views = getViewsById(bookKey.split('-')[0]!);
    let cleared = 0;
    storedNotes.forEach((note) => {
      if (note.type === 'annotation' && !note.deletedAt) {
        note.deletedAt = now;
        cleared += 1;
        // Drop the rendered overlay so the page reflects the cleared
        // state immediately without waiting for a relocate.
        views.forEach((view) => removeBookNoteOverlays(view, note));
      }
    });
    if (cleared === 0) return;

    const updatedConfig = updateBooknotes(bookKey, storedNotes);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
    // Reset any browse-mode state in the annotations sidebar tab so it
    // doesn't keep paging through stale (now soft-deleted) entries.
    clearBooknotesNav(bookKey);

    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Cleared {{count}} highlights and notes.', { count: cleared }),
      timeout: 2000,
    });
  };

  const selectionAnnotated = selection?.annotated;
  // For the ✓ (global) toggle in HighlightOptions: figure out whether
  // the booknote anchored at the current selection is currently global,
  // and whether the toggle should be shown at all (only meaningful for
  // re-flowable formats with a non-empty selection text).
  const currentAnnotation = selection?.cfi
    ? config.booknotes?.find(
        (a) => a.type === 'annotation' && a.style && !a.deletedAt && a.cfi === selection.cfi,
      )
    : undefined;
  const globalToggleAvailable =
    !bookData.isFixedLayout &&
    !!selection?.annotated &&
    !!currentAnnotation &&
    !!selection?.text &&
    selection.text.trim().length > 0;
  const globalToggleActive = !!currentAnnotation?.global;
  const toolButtons = visibleAnnotationToolButtons.map(({ type, label, Icon }) => {
    switch (type) {
      case 'copy':
        return { tooltipText: _(label), Icon, onClick: handleCopy };
      case 'highlight':
        return {
          tooltipText: selectionAnnotated ? _('Delete Highlight') : _(label),
          Icon: selectionAnnotated ? RiDeleteBinLine : Icon,
          onClick: handleHighlight,
        };
      case 'annotate':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleAnnotate,
        };
      case 'search':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleSearch,
        };
      case 'dictionary':
        return { tooltipText: _(label), Icon, onClick: handleDictionary };
      case 'translate':
        return { tooltipText: _(label), Icon, onClick: handleTranslation };
      case 'tts':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleSpeakText,
        };
      case 'proofread':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleProofread,
          disabled: bookData.book?.format !== 'EPUB',
        };
      case 'inlineinsight':
        return { tooltipText: _(label), Icon, onClick: handleInlineInsight };
      default:
        return { tooltipText: '', Icon, onClick: () => {} };
    }
  });

  return (
    <div ref={containerRef} role='toolbar' tabIndex={-1}>
      {showDictionaryPopup &&
        (() => {
          // Below `sm` (or short landscape) we present the dictionary as a
          // bottom sheet — the anchored popup gets cramped at this size.
          // Matches the `isMobile` heuristic used by `Dialog`.
          const useSheet = window.innerWidth < 640 || window.innerHeight < 640;
          const onManage = () => {
            // Dismiss so the user returns to the reader cleanly when they
            // close settings; the dictionaries sub-page in SettingsDialog
            // is enough surface for managing providers.
            handleDismissPopupAndSelection();
            setSettingsDialogBookKey(bookKey);
            setActiveSettingsItemId('settings.language.dictionaries.manage');
            setSettingsDialogOpen(true);
          };
          if (useSheet) {
            return (
              <DictionarySheet
                word={selection?.text as string}
                lang={bookData.bookDoc?.metadata.language as string}
                onDismiss={handleDismissPopupAndSelection}
                onManage={onManage}
              />
            );
          }
          if (!trianglePosition || !dictPopupPosition) return null;
          return (
            <DictionaryPopup
              word={selection?.text as string}
              lang={bookData.bookDoc?.metadata.language as string}
              position={dictPopupPosition}
              trianglePosition={trianglePosition}
              popupWidth={dictPopupWidth}
              popupHeight={dictPopupHeight}
              onDismiss={handleDismissPopupAndSelection}
              onManage={onManage}
            />
          );
        })()}
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
          globalToggleAvailable={globalToggleAvailable}
          globalToggleActive={globalToggleActive}
          onToggleGlobal={handleToggleGlobal}
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
          onManage={() => {
            handleDismissPopupAndSelection();
            setProofreadRulesVisibility(true);
          }}
        />
      )}
      {showInlineInsightPopup && trianglePosition && dictPopupPosition && selection && (
        <InlineInsightPopup
          bookKey={bookKey}
          selection={selection}
          position={dictPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={dictPopupWidth}
          popupHeight={dictPopupHeight}
          initialAnswer={inlineInsightSnapshot?.answer}
          initialContext={inlineInsightSnapshot?.context}
          onAnswerReady={handleInlineInsightAnswerReady}
          onDismiss={handleDismissPopupAndSelection}
        />
      )}
      {editingAnnotation && editingAnnotation.color && selection && (
        <AnnotationRangeEditor
          bookKey={bookKey}
          isVertical={viewSettings.vertical}
          annotation={editingAnnotation}
          selection={selection}
          handleColor={selectedColor}
          externalDragPoint={externalDragPoint}
          getAnnotationText={getAnnotationText}
          setSelection={setSelection}
          onStartEdit={handleStartEditAnnotation}
        />
      )}
      {showExportDialog && exportData && bookData.book && (
        <ExportMarkdownDialog
          bookKey={bookKey}
          isOpen={showExportDialog}
          bookHash={bookData.book.hash}
          bookTitle={bookData.book.title}
          bookAuthor={bookData.book.author || ''}
          booknotes={exportData.booknotes}
          booknoteGroups={exportData.booknoteGroups}
          onCancel={handleCancelExport}
          onExport={handleConfirmExport}
        />
      )}
      {clearAnnotationsCount > 0 && (
        <ModalPortal>
          <Alert
            title={_('Clear Annotations')}
            message={_('Are you sure to clear all {{count}} highlights and notes?', {
              count: clearAnnotationsCount,
            })}
            onCancel={() => setClearAnnotationsCount(0)}
            onConfirm={() => {
              setClearAnnotationsCount(0);
              performClearAnnotations();
            }}
          />
        </ModalPortal>
      )}
    </div>
  );
};

export default Annotator;
