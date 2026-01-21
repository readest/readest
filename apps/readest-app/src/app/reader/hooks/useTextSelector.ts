import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { isPointerInsideSelection, TextSelection } from '@/utils/sel';
import { useInstantAnnotation } from './useInstantAnnotation';

export const useTextSelector = (
  bookKey: string,
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>,
  getAnnotationText: (range: Range) => Promise<string>,
  handleDismissPopup: () => void,
) => {
  const { appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const osPlatform = getOSPlatform();

  const isPopuped = useRef(false);
  const isUpToPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isTouchStarted = useRef(false);
  const selectionPosition = useRef<number | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const isInstantAnnotating = useRef(false);
  const isInstantAnnotated = useRef(false);

  const {
    isInstantAnnotationEnabled,
    handleInstantAnnotationPointerDown,
    handleInstantAnnotationPointerMove,
    handleInstantAnnotationPointerCancel,
    handleInstantAnnotationPointerUp,
  } = useInstantAnnotation({ bookKey, getAnnotationText, setSelection });

  const isValidSelection = (sel: Selection) => {
    return sel && sel.toString().trim().length > 0 && sel.rangeCount > 0;
  };

  const makeSelection = async (sel: Selection, index: number, rebuildRange = false) => {
    isTextSelected.current = true;
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

  const startInstantAnnotating = (ev: PointerEvent) => {
    isInstantAnnotating.current = true;
    isInstantAnnotated.current = false;
    if (view) view.renderer.scrollLocked = true;
    (ev.target as HTMLElement).style.userSelect = 'none';
  };

  const stopInstantAnnotating = (ev: PointerEvent) => {
    isInstantAnnotating.current = false;
    isInstantAnnotated.current = false;
    if (view) view.renderer.scrollLocked = false;
    (ev.target as HTMLElement).style.userSelect = '';
  };

  const handlePointerDown = (doc: Document, index: number, ev: PointerEvent) => {
    lastPointerType.current = ev.pointerType;

    if (isInstantAnnotationEnabled()) {
      const handled = handleInstantAnnotationPointerDown(doc, index, ev);
      if (handled) {
        ev.preventDefault();
        startInstantAnnotating(ev);
      }
    }
  };

  const handlePointerMove = (doc: Document, index: number, ev: PointerEvent) => {
    if (isInstantAnnotating.current) {
      ev.preventDefault();
      isInstantAnnotated.current = handleInstantAnnotationPointerMove(doc, index, ev);
    }
  };

  const handlePointerCancel = (_doc: Document, _index: number, ev: PointerEvent) => {
    if (isInstantAnnotating.current) {
      stopInstantAnnotating(ev);
      handleInstantAnnotationPointerCancel();
    }
  };

  const handlePointerUp = async (doc: Document, index: number, ev?: PointerEvent) => {
    if (isInstantAnnotating.current && ev) {
      stopInstantAnnotating(ev);
      const handled = await handleInstantAnnotationPointerUp(doc, index, ev);
      if (handled) {
        isTextSelected.current = true;
        return;
      } else {
        // If instant annotation was not created, we let the event propagate
        // as an iframe click event which relies on a mousedown event
        (ev.target as Element)?.dispatchEvent(
          new MouseEvent('mousedown', {
            ...ev,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }

    // Available on iOS and Desktop, fired at touchend or mouseup
    // Note that on Android, we mock pointer events with native touch events
    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      const isPointerInside = ev && isPointerInsideSelection(sel, ev);
      const isIOS = osPlatform === 'ios' || appService?.isIOSApp;

      if (isPointerInside && isIOS) {
        makeSelectionOnIOS(sel, index);
      } else if (isPointerInside) {
        isUpToPopup.current = true;
        makeSelection(sel, index, true);
      }
    }
  };
  const handleTouchStart = () => {
    isTouchStarted.current = true;
  };
  const handleTouchMove = (ev: TouchEvent) => {
    if (isInstantAnnotating.current && isInstantAnnotated.current) {
      ev.preventDefault();
    }
  };
  const handleTouchEnd = () => {
    isTouchStarted.current = false;
  };
  const handleSelectionchange = (doc: Document, index: number) => {
    // Available on iOS, Android and Desktop, fired when the selection is changed
    if (osPlatform !== 'android' || !appService?.isAndroidApp) return;

    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      if (!selectionPosition.current) {
        selectionPosition.current = view?.renderer?.start || null;
      }
      makeSelection(sel, index, false);
    } else {
      selectionPosition.current = null;
    }
  };
  const handleScroll = () => {
    // Prevent the container from scrolling when text is selected in paginated mode
    // FIXME: this is a workaround for issue #873
    // TODO: support text selection across pages
    if (osPlatform !== 'android' || !appService?.isAndroidApp) return;

    const viewSettings = getViewSettings(bookKey);
    if (viewSettings?.scrolled) return;

    if (isTextSelected.current && view?.renderer?.containerPosition && selectionPosition.current) {
      console.warn('Keep container position', selectionPosition.current);
      view.renderer.containerPosition = selectionPosition.current;
    }
  };

  const handleShowPopup = (showPopup: boolean) => {
    setTimeout(() => {
      if (showPopup && !isPopuped.current) {
        isUpToPopup.current = false;
      }
      isPopuped.current = showPopup;
    }, 500);
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
    const handleSingleClick = (): boolean => {
      if (isUpToPopup.current) {
        isUpToPopup.current = false;
        return true;
      }
      if (isTextSelected.current) {
        handleDismissPopup();
        isTextSelected.current = false;
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
  };
};
