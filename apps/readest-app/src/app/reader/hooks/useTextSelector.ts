import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getLocale, getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { getTextFromRange, TextSelection } from '@/utils/sel';
import { transformContent } from '@/services/transformService';
import { TransformContext } from '@/services/transformers/types';

export const useTextSelector = (
  bookKey: string,
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>,
  handleDismissPopup: () => void,
) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey)!;
  const primaryLang = bookData.book?.primaryLanguage || 'en';
  const osPlatform = getOSPlatform();

  const isPopuped = useRef(false);
  const isUpToPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isTouchStarted = useRef(false);
  const selectionPosition = useRef<number | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const [textSelected, setTextSelected] = useState(false);

  const isValidSelection = (sel: Selection) => {
    return sel && sel.toString().trim().length > 0 && sel.rangeCount > 0;
  };

  const transformCtx: TransformContext = {
    bookKey,
    viewSettings: getViewSettings(bookKey)!,
    userLocale: getLocale(),
    content: '',
    transformers: ['punctuation'],
    reversePunctuationTransform: true,
  };
  const getAnnotationText = async (range: Range) => {
    transformCtx['content'] = getTextFromRange(range, primaryLang.startsWith('ja') ? ['rt'] : []);
    return await transformContent(transformCtx);
  };
  const makeSelection = async (sel: Selection, index: number, rebuildRange = false) => {
    isTextSelected.current = true;
    setTextSelected(true);
    const range = sel.getRangeAt(0);
    if (rebuildRange) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setSelection({
      key: bookKey,
      text: await getAnnotationText(range),
      cfi: view?.getCFI(index, range),
      range,
      index,
    });
  };
  // FIXME: extremely hacky way to dismiss system selection tools on iOS
  const makeSelectionOnIOS = async (sel: Selection, index: number) => {
    isTextSelected.current = true;
    setTextSelected(true);
    const range = sel.getRangeAt(0);
    setTimeout(() => {
      sel.removeAllRanges();
      setTimeout(async () => {
        if (!isTextSelected.current) return;
        sel.addRange(range);
        setSelection({
          key: bookKey,
          text: await getAnnotationText(range),
          cfi: view?.getCFI(index, range),
          range,
          index,
        });
      }, 30);
    }, 30);
  };
  const handleSelectionchange = (doc: Document) => {
    // Available on iOS, Android and Desktop, fired when the selection is changed
    // Ideally the popup only shows when the selection is done,
    const sel = doc.getSelection() as Selection;
    if (osPlatform === 'ios' || appService?.isIOSApp) return;
    if (!isValidSelection(sel)) {
      if (!isUpToPopup.current) {
        handleDismissPopup();
        isTextSelected.current = false;
        setTextSelected(false);
      }
      if (isPopuped.current) {
        isUpToPopup.current = false;
      }
      return;
    }

    isUpToPopup.current = true;
  };
  const isPointerInsideSelection = (selection: Selection, ev: PointerEvent) => {
    if (selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const padding = 80;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]!;
      if (
        ev.clientX >= rect.left - padding &&
        ev.clientX <= rect.right + padding &&
        ev.clientY >= rect.top - padding &&
        ev.clientY <= rect.bottom + padding
      ) {
        return true;
      }
    }
    return false;
  };
  const handlePointerdown = (e: PointerEvent) => {
    lastPointerType.current = e.pointerType;
  };
  const handlePointerup = (doc: Document, index: number, ev?: PointerEvent) => {
    // Available on iOS and Desktop, fired at touchend or mouseup
    // Note that on Android, we mock pointer events with native touch events
    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      const isPointerInside = ev && isPointerInsideSelection(sel, ev);
      const isIOS = osPlatform === 'ios' || appService?.isIOSApp;
      const isAndroid = appService?.isAndroidApp;

      if (isPointerInside && isIOS) {
        makeSelectionOnIOS(sel, index);
      } else if (isPointerInside || isAndroid) {
        makeSelection(sel, index, true);
      }
    }
  };
  const handleTouchStart = () => {
    isTouchStarted.current = true;
  };
  const handleTouchEnd = () => {
    isTouchStarted.current = false;
  };
  const handleScroll = () => {
    // Prevent the container from scrolling when text is selected in paginated mode
    // FIXME: this is a workaround for issue #873
    // TODO: support text selection across pages
    const viewSettings = getViewSettings(bookKey);
    if (
      appService?.isAndroidApp &&
      isTextSelected.current &&
      !viewSettings?.scrolled &&
      view?.renderer?.containerPosition &&
      selectionPosition.current
    ) {
      console.warn('Keep container position', selectionPosition.current);
      view.renderer.containerPosition = selectionPosition.current;
    }
  };

  const handleShowPopup = (showPopup: boolean) => {
    setTimeout(
      () => {
        if (showPopup && !isPopuped.current) {
          isUpToPopup.current = false;
        }
        isPopuped.current = showPopup;
      },
      ['android', 'ios'].includes(osPlatform) || appService?.isIOSApp ? 0 : 500,
    );
  };

  const handleUpToPopup = () => {
    isUpToPopup.current = true;
  };

  const handleContextmenu = (event: Event) => {
    if (appService?.isMobile) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    } else if (lastPointerType.current === 'touch' || lastPointerType.current === 'pen') {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    return;
  };

  useEffect(() => {
    if (isTextSelected.current && !selectionPosition.current) {
      selectionPosition.current = view?.renderer?.start || null;
    } else if (!isTextSelected.current) {
      selectionPosition.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textSelected]);

  useEffect(() => {
    const handleSingleClick = (): boolean => {
      if (isUpToPopup.current) {
        isUpToPopup.current = false;
        return true;
      }
      if (isTextSelected.current) {
        handleDismissPopup();
        isTextSelected.current = false;
        setTextSelected(false);
        view?.deselect();
        return true;
      }
      if (isPopuped.current) {
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

  return {
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
  };
};
