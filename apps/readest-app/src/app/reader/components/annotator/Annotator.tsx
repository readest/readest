import React, { useState, useEffect, useRef } from 'react';
import { FiSearch } from 'react-icons/fi';
import { FiCopy } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { FaWikipediaW } from 'react-icons/fa';
import { BsPencilSquare } from 'react-icons/bs';
import { RiDeleteBinLine } from 'react-icons/ri';
import { BsTranslate } from 'react-icons/bs';
import { TbHexagonLetterD } from 'react-icons/tb';
import { FaHeadphones } from 'react-icons/fa6';

import * as CFI from 'foliate-js/epubcfi.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { useEnv } from '@/context/EnvContext';
import { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useFoliateEvents } from '../../hooks/useFoliateEvents';
import { useNotesSync } from '../../hooks/useNotesSync';
import { getPopupPosition, getPosition, Position, TextSelection } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import AnnotationPopup from './AnnotationPopup';
import WiktionaryPopup from './WiktionaryPopup';
import WikipediaPopup from './WikipediaPopup';
import DeepLPopup from './DeepLPopup';

const Annotator: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, getBookData, updateBooknotes } = useBookDataStore();
  const { getProgress, getView, getViewsById, getViewSettings } = useReaderStore();
  const { setNotebookVisible, setNotebookNewAnnotation } = useNotebookStore();

  useNotesSync(bookKey);

  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey)!;
  const bookData = getBookData(bookKey)!;
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;

  const isShowingPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isClickToShowPopup = useRef(false);
  const [selection, setSelection] = useState<TextSelection | null>();
  const [showAnnotPopup, setShowAnnotPopup] = useState(false);
  const [showWiktionaryPopup, setShowWiktionaryPopup] = useState(false);
  const [showWikipediaPopup, setShowWikipediaPopup] = useState(false);
  const [showDeepLPopup, setShowDeepLPopup] = useState(false);
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
  const transPopupHeight = Math.min(360, maxHeight);
  const annotPopupWidth = useResponsiveSize(280);
  const annotPopupHeight = useResponsiveSize(44);

  const onLoad = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { doc, index } = detail;
    const handlePointerup = () => {
      const sel = doc.getSelection();
      if (sel && sel.toString().trim().length > 0 && sel.rangeCount > 0) {
        isTextSelected.current = true;
        setSelection({ key: bookKey, text: sel.toString(), range: sel.getRangeAt(0), index });
      }
    };
    const handleTouchmove = () => {
      setShowAnnotPopup(false);
    };
    if (bookData.book?.format !== 'PDF') {
      detail.doc?.addEventListener('pointerup', handlePointerup);
      detail.doc?.addEventListener('touchmove', handleTouchmove);
    }
  };

  const onDrawAnnotation = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { draw, annotation, doc, range } = detail;
    const { style, color } = annotation as BookNote;
    if (style === 'highlight') {
      draw(Overlayer.highlight, { color });
    } else if (['underline', 'squiggly'].includes(style as string)) {
      const { defaultView } = doc;
      const node = range.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const { writingMode } = defaultView.getComputedStyle(el);
      draw(Overlayer[style as keyof typeof Overlayer], { writingMode, color });
    }
  };

  const onShowAnnotation = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { value: cfi, index, range } = detail;
    const { booknotes = [] } = config;
    const annotations = booknotes.filter(
      (booknote) => booknote.type === 'annotation' && !booknote.deletedAt,
    );
    const annotation = annotations.find((annotation) => annotation.cfi === cfi);
    if (!annotation) return;
    const selection = { key: bookKey, annotated: true, text: annotation.text ?? '', range, index };
    isClickToShowPopup.current = true;
    setSelectedStyle(annotation.style!);
    setSelectedColor(annotation.color!);
    setSelection(selection);
  };

  useFoliateEvents(view, { onLoad, onDrawAnnotation, onShowAnnotation });

  const handleDismissPopup = () => {
    setSelection(null);
    setShowAnnotPopup(false);
    setShowWiktionaryPopup(false);
    setShowWikipediaPopup(false);
    setShowDeepLPopup(false);
    isShowingPopup.current = false;
  };

  const handleDismissPopupAndSelection = () => {
    handleDismissPopup();
    view?.deselect();
    isTextSelected.current = false;
  };

  useEffect(() => {
    const handleSingleClick = (): boolean => {
      if (isClickToShowPopup.current) {
        isClickToShowPopup.current = false;
        return true;
      }
      if (isTextSelected.current) {
        handleDismissPopupAndSelection();
        return true;
      }
      if (showAnnotPopup || isShowingPopup.current) {
        handleDismissPopup();
        return true;
      }
      return false;
    };

    eventDispatcher.onSync('iframe-single-click', handleSingleClick);
    return () => {
      eventDispatcher.offSync('iframe-single-click', handleSingleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setHighlightOptionsVisible(!!(selection && selection.annotated));
    if (selection && selection.text.trim().length > 0) {
      const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
      if (!gridFrame) return;
      const rect = gridFrame.getBoundingClientRect();
      const triangPos = getPosition(selection.range, rect, viewSettings.vertical);
      const annotPopupPos = getPopupPosition(
        triangPos,
        rect,
        annotPopupWidth,
        annotPopupHeight,
        popupPadding,
      );
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
      setShowAnnotPopup(true);
      setAnnotPopupPosition(annotPopupPos);
      setDictPopupPosition(dictPopupPos);
      setTranslatorPopupPosition(transPopupPos);
      setTrianglePosition(triangPos);
      isShowingPopup.current = true;
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
      console.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const handleCopy = () => {
    if (!selection || !selection.text) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to notebook'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });

    const { booknotes: annotations = [] } = config;
    if (selection) navigator.clipboard?.writeText(selection.text);
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
    handleDismissPopupAndSelection();
    setNotebookVisible(true);
  };

  const handleHighlight = (update = false) => {
    if (!selection || !selection.text) return;
    setHighlightOptionsVisible(true);
    const { booknotes: annotations = [] } = config;
    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return;
    const style = settings.globalReadSettings.highlightStyle;
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
    setShowAnnotPopup(false);
    setHighlightOptionsVisible(false);
    setNotebookVisible(true);
    setNotebookNewAnnotation(selection);
    handleHighlight(true);
  };

  const handleSearch = () => {
    if (!selection || !selection.text) return;
    setShowAnnotPopup(false);
    eventDispatcher.dispatch('search', { term: selection.text });
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

  const selectionAnnotated = selection?.annotated;
  const buttons = [
    { tooltipText: _('Copy'), Icon: FiCopy, onClick: handleCopy },
    {
      tooltipText: selectionAnnotated ? _('Delete Highlight') : _('Highlight'),
      Icon: selectionAnnotated ? RiDeleteBinLine : PiHighlighterFill,
      onClick: handleHighlight,
    },
    { tooltipText: _('Annotate'), Icon: BsPencilSquare, onClick: handleAnnotate },
    { tooltipText: _('Search'), Icon: FiSearch, onClick: handleSearch },
    { tooltipText: _('Dictionary'), Icon: TbHexagonLetterD, onClick: handleDictionary },
    { tooltipText: _('Wikipedia'), Icon: FaWikipediaW, onClick: handleWikipedia },
    { tooltipText: _('Translate'), Icon: BsTranslate, onClick: handleTranslation },
    { tooltipText: _('Speak'), Icon: FaHeadphones, onClick: handleSpeakText },
  ];

  return (
    <div>
      {showWiktionaryPopup && trianglePosition && dictPopupPosition && (
        <WiktionaryPopup
          word={selection?.text as string}
          lang={bookData.bookDoc?.metadata.language as string}
          position={dictPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={dictPopupWidth}
          popupHeight={dictPopupHeight}
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
        />
      )}
      {showDeepLPopup && trianglePosition && translatorPopupPosition && (
        <DeepLPopup
          text={selection?.text as string}
          position={translatorPopupPosition}
          trianglePosition={trianglePosition}
          popupWidth={transPopupWidth}
          popupHeight={transPopupHeight}
        />
      )}
      {showAnnotPopup && trianglePosition && annotPopupPosition && (
        <AnnotationPopup
          buttons={buttons}
          position={annotPopupPosition}
          trianglePosition={trianglePosition}
          highlightOptionsVisible={highlightOptionsVisible}
          selectedStyle={selectedStyle}
          selectedColor={selectedColor}
          popupWidth={annotPopupWidth}
          popupHeight={annotPopupHeight}
          onHighlight={handleHighlight}
        />
      )}
    </div>
  );
};

export default Annotator;
