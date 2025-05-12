import { useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { getTextFromRange, TextSelection } from '@/utils/sel';
import { transformContent } from '@/services/transformService';

export const useTextSelector = (
  bookKey: string,
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>,
  handleDismissPopup: () => void,
) => {
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const bookData = getBookData(bookKey)!;
  const primaryLang = bookData.book?.primaryLanguage || 'en';
  const osPlatform = getOSPlatform();

  const isTextSelected = useRef(false);
  const isAnnotPopuped = useRef(false);
  const isAnnotUpToPopup = useRef(false);
  const selectionPosition = useRef<number | null>(null);

  const isValidSelection = (sel: Selection) => {
    return sel && sel.toString().trim().length > 0 && sel.rangeCount > 0;
  };

  const transformCtx = {
    bookKey,
    viewSettings: getViewSettings(bookKey)!,
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
    const range = sel.getRangeAt(0);
    if (rebuildRange) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setSelection({ key: bookKey, text: await getAnnotationText(range), range, index });
  };
  // FIXME: extremely hacky way to dismiss system selection tools on iOS
  const makeSelectionOnIOS = async (sel: Selection, index: number) => {
    isTextSelected.current = true;
    const range = sel.getRangeAt(0);
    setTimeout(() => {
      sel.removeAllRanges();
      setTimeout(async () => {
        if (!isTextSelected.current) return;
        sel.addRange(range);
        setSelection({ key: bookKey, text: await getAnnotationText(range), range, index });
      }, 40);
    }, 0);
  };
  const handleSelectionchange = (doc: Document, index: number) => {
    // Available on iOS, Android and Desktop, fired when the selection is changed
    // Ideally the popup only shows when the selection is done,
    const sel = doc.getSelection() as Selection;
    if (osPlatform === 'ios') return;
    if (!isValidSelection(sel)) {
      if (!isAnnotUpToPopup.current) {
        handleDismissPopup();
        isTextSelected.current = false;
      }
      return;
    }

    // On Android no proper events are fired to notify selection done,
    // we make the popup show when the selection is changed
    if (osPlatform === 'android') {
      makeSelection(sel, index, false);
    }
  };
  const handlePointerup = (doc: Document, index: number) => {
    // Available on iOS and Desktop, fired at touchend or mouseup
    // Note that on Android, pointerup event is fired after an additional touch event
    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      if (osPlatform === 'ios') {
        makeSelectionOnIOS(sel, index);
      } else {
        makeSelection(sel, index, true);
      }
    }
  };
  const handleScroll = () => {
    // Prevent the container from scrolling when text is selected in paginated mode
    // This is a workaround for the issue #873
    // TODO: support text selection across pages
    if (!viewSettings?.scrolled && view?.renderer?.containerPosition && selectionPosition.current) {
      view.renderer.containerPosition = selectionPosition.current;
    }
  };

  const handleAnnotPopup = (showAnnotPopup: boolean) => {
    setTimeout(
      () => {
        isAnnotPopuped.current = showAnnotPopup;
      },
      ['android', 'ios'].includes(osPlatform) ? 0 : 500,
    );
  };

  const handleShowAnnotation = () => {
    isAnnotUpToPopup.current = true;
  };

  useEffect(() => {
    if (isTextSelected.current && !selectionPosition.current) {
      selectionPosition.current = view?.renderer?.start || null;
    } else if (!isTextSelected.current) {
      selectionPosition.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTextSelected.current]);

  useEffect(() => {
    const handleSingleClick = (): boolean => {
      if (isAnnotUpToPopup.current) {
        isAnnotUpToPopup.current = false;
        return true;
      }
      if (isTextSelected.current) {
        handleDismissPopup();
        isTextSelected.current = false;
        return true;
      }
      if (isAnnotPopuped.current) {
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
    handleScroll,
    handlePointerup,
    handleSelectionchange,
    handleAnnotPopup,
    handleShowAnnotation,
  };
};
