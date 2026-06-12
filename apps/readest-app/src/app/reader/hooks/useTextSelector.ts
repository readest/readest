import { useEffect, useRef } from 'react';
import { BookNote } from '@/types/book';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import {
  isHyphenHandleBugProneRange,
  isPointerInsideSelection,
  Point,
  repairJumpedSelectionRange,
  TextSelection,
} from '@/utils/sel';
import { useInstantAnnotation } from './useInstantAnnotation';

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

// The selection focus must rest in a screen corner for this long before the
// page auto-turns, so merely passing a corner mid-drag doesn't flip the page.
const AUTO_TURN_DWELL_MS = 500;
// The corner zone is a quarter-ellipse within this radius of the actual corner
// (as a fraction of each axis). Kept tight so it is only the corner itself — a
// larger/rectangular zone catches normal selections that end in the lower-right
// of the page and turns the page unexpectedly.
const AUTO_TURN_CORNER_FRACTION = 0.15;

type Corner = 'br' | 'tl';

// Which screen corner a point sits in: bottom-right turns forward, top-left
// turns back. The zone is a quarter-ellipse of radius FRACTION around each
// corner. Returns null when the point is in neither.
const cornerOf = (x: number, y: number, w: number, h: number): Corner | null => {
  if (w <= 0 || h <= 0) return null;
  const rx = w * AUTO_TURN_CORNER_FRACTION;
  const ry = h * AUTO_TURN_CORNER_FRACTION;
  const inEllipse = (dx: number, dy: number) => (dx / rx) ** 2 + (dy / ry) ** 2 <= 1;
  if (inEllipse(w - x, h - y)) return 'br';
  if (inEllipse(x, y)) return 'tl';
  return null;
};

// Map a window-coordinate point to the corner of the reading area it sits in,
// if any. Corners are measured against `area` (the visible text bounds in window
// coordinates) so they land on the text, not the page margins or a sidebar.
const cornerAt = (xWin: number, yWin: number, area: DOMRect | null): Corner | null => {
  if (!area || area.width <= 0 || area.height <= 0) return null;
  const x = xWin - area.left;
  const y = yWin - area.top;
  // Ignore a point outside the visible text (e.g. the selection caret jumping
  // into the next, off-screen column while dragging at the edge).
  if (x < 0 || x > area.width || y < 0 || y > area.height) return null;
  return cornerOf(x, y, area.width, area.height);
};

// Window-coordinate position of the selection focus (caret), or null. The book
// content lives in a (possibly very wide, multi-column) iframe translated by the
// pagination offset, so map the caret from iframe space via the iframe element's
// on-screen rect.
const focusCaretWindowPos = (doc: Document, sel: Selection): { x: number; y: number } | null => {
  const focusNode = sel.focusNode;
  const win = doc.defaultView;
  if (!focusNode || !win) return null;
  let rect: DOMRect;
  try {
    const range = doc.createRange();
    const offset =
      focusNode.nodeType === Node.TEXT_NODE
        ? Math.min(sel.focusOffset, (focusNode.textContent ?? '').length)
        : sel.focusOffset;
    range.setStart(focusNode, offset);
    range.collapse(true);
    rect = range.getBoundingClientRect();
  } catch {
    return null;
  }
  // An unmeasurable range (e.g. focus on an empty element) collapses to 0,0,0,0.
  if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.right === 0) return null;
  const feRect = win.frameElement?.getBoundingClientRect();
  return {
    x: (rect.left + rect.right) / 2 + (feRect?.left ?? 0),
    y: (rect.top + rect.bottom) / 2 + (feRect?.top ?? 0),
  };
};

// The reading frame in window coordinates: the <foliate-view> element's rect
// (a stable element, so it has a sensible page-sized width — unlike the visible
// text range, whose box spans the whole multi-column iframe), inset by the page
// content margins so the corner zone lands on the text area, not the margin.
// Falls back to the reading container (gridcell).
const getReadingAreaRect = (bookKey: string, insets: Insets = ZERO_INSETS): DOMRect | null => {
  const cell = document.querySelector(`#gridcell-${bookKey}`);
  if (!cell) return null;
  const frame = cell.querySelector('foliate-view') ?? cell;
  const r = frame.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return new DOMRect(
    r.left + insets.left,
    r.top + insets.top,
    Math.max(0, r.width - insets.left - insets.right),
    Math.max(0, r.height - insets.top - insets.bottom),
  );
};

export const useTextSelector = (
  bookKey: string,
  contentInsets: Insets,
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>,
  setEditingAnnotation: React.Dispatch<React.SetStateAction<BookNote | null>>,
  setExternalDragPoint: React.Dispatch<React.SetStateAction<Point | null>>,
  getAnnotationText: (range: Range) => Promise<string>,
  handleDismissPopup: () => void,
) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings, getProgress } = useReaderStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const osPlatform = getOSPlatform();

  // The reading frame inset by the page content margins, used to measure the
  // auto-turn corners so they land on the text area, not the margin.
  const readingAreaRect = (): DOMRect | null => getReadingAreaRect(bookKey, contentInsets);

  const isPopuped = useRef(false);
  const isUpToPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isTouchStarted = useRef(false);
  const selectionPosition = useRef<number | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const isInstantAnnotating = useRef(false);
  const isInstantAnnotated = useRef(false);
  const annotationStartPoint = useRef<Point | null>(null);
  const autoTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The corner an input signal is currently engaged in. Stays set after a turn so
  // the dwell can't re-arm while held — a signal must leave the corner and return
  // to turn another page.
  const engagedCorner = useRef<Corner | null>(null);
  const isAutoTurning = useRef(false);
  // Latest pointer position in window coords (from pointermove or, on Android,
  // native touchmove). One of the engagement signals alongside the caret.
  const pointerPos = useRef<{ x: number; y: number } | null>(null);

  // Android hyphen selection-bounds bug (#1553): the selection anchor captured
  // at the first selectionchange of a touch gesture, plus whether that initial
  // range is prone to the bug (starts at the first word of a hyphenated
  // paragraph). Evaluated once per gesture.
  const gestureInitialRef = useRef<{ node: Node; offset: number; prone: boolean } | null>(null);
  // While we mutate the DOM selection ourselves (handle suppression, custom
  // handle drags), selectionchange events are echoes of our own writes —
  // handleSelectionchange must ignore them. Cleared on a delay because
  // selectionchange dispatches a task after the mutation.
  const programmaticSelectionRef = useRef(false);
  const programmaticClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guardProgrammaticSelection = () => {
    if (programmaticClearTimer.current) clearTimeout(programmaticClearTimer.current);
    programmaticSelectionRef.current = true;
  };

  const releaseProgrammaticSelection = () => {
    if (programmaticClearTimer.current) clearTimeout(programmaticClearTimer.current);
    programmaticClearTimer.current = setTimeout(() => {
      programmaticSelectionRef.current = false;
    }, 150);
  };

  const {
    isInstantAnnotationEnabled,
    handleInstantAnnotationPointerDown,
    handleInstantAnnotationPointerMove,
    handleInstantAnnotationPointerCancel,
    handleInstantAnnotationPointerUp,
  } = useInstantAnnotation({
    bookKey,
    getAnnotationText,
    setSelection,
    setEditingAnnotation,
    setExternalDragPoint,
  });

  const isValidSelection = (sel: Selection) => {
    return sel && sel.toString().trim().length > 0 && sel.rangeCount > 0;
  };

  const makeSelection = async (
    sel: Selection,
    index: number,
    rebuildRange = false,
    handlesSuppressed = false,
  ) => {
    isTextSelected.current = true;
    const range = sel.getRangeAt(0);
    if (rebuildRange) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const progress = getProgress(bookKey);
    setSelection({
      key: bookKey,
      text: await getAnnotationText(range),
      cfi: view?.getCFI(index, range),
      page: bookData?.isFixedLayout ? index + 1 : progress?.page || 0,
      range,
      index,
      handlesSuppressed,
    });
  };

  const startInstantAnnotating = (ev: PointerEvent) => {
    isInstantAnnotating.current = true;
    isInstantAnnotated.current = false;
    annotationStartPoint.current = { x: ev.clientX, y: ev.clientY };
    if (view) view.renderer.scrollLocked = true;
    (ev.target as HTMLElement).style.userSelect = 'none';
  };

  const stopInstantAnnotating = (ev: PointerEvent) => {
    isInstantAnnotating.current = false;
    isInstantAnnotated.current = false;
    annotationStartPoint.current = null;
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
    // The listener lives on the book iframe's document, so ev.clientX/Y are in
    // the (very wide, multi-column) iframe viewport. Map to window coordinates
    // via the iframe element's on-screen rect, like the selection caret.
    const feRect = doc.defaultView?.frameElement?.getBoundingClientRect();
    pointerPos.current = {
      x: ev.clientX + (feRect?.left ?? 0),
      y: ev.clientY + (feRect?.top ?? 0),
    };
    if (isInstantAnnotating.current) {
      // In scroll mode, detect gesture direction before committing to annotation.
      // Cancel if the gesture is along the scroll axis (vertical for normal, horizontal
      // for vertical writing mode) since the user likely intends to scroll.
      if (!isInstantAnnotated.current && annotationStartPoint.current) {
        const dx = Math.abs(ev.clientX - annotationStartPoint.current.x);
        const dy = Math.abs(ev.clientY - annotationStartPoint.current.y);
        const distance = Math.sqrt(dx * dx + dy * dy);
        const viewSettings = getViewSettings(bookKey);
        const isScrollGesture = viewSettings?.vertical ? dy < 3 * dx : dx < 3 * dy;
        if (distance >= 10 && isScrollGesture) {
          stopInstantAnnotating(ev);
          handleInstantAnnotationPointerCancel();
          return;
        }
      }
      ev.preventDefault();
      isInstantAnnotated.current = handleInstantAnnotationPointerMove(doc, index, ev);
      return;
    }

    // Pointer-driven auto page-turn (#1354) for web/desktop/iOS, where the
    // pointer is the reliable, stable signal at the corner. Android uses the
    // caret in handleSelectionchange (no pointermove during a selection drag).
    // Android uses native touchmove (handleNativeTouchMove) — the iframe
    // pointermove doesn't fire there during a native selection drag.
    const isAndroid = osPlatform === 'android' && appService?.isAndroidApp;
    if (isAndroid) return;
    const viewSettings = getViewSettings(bookKey);
    const sel = doc.getSelection();
    const valid = !!sel && isValidSelection(sel);
    const corner = !viewSettings?.scrolled && valid ? pointerCornerNow() : null;
    noteCorner(corner, doc);
  };

  // Android native touchmove — the pointer engagement signal during a native
  // selection drag (the iframe pointermove doesn't fire there). The native x/y
  // are physical device pixels relative to the window; convert to CSS px.
  const handleNativeTouchMove = (x: number, y: number, doc: Document) => {
    const dpr = window.devicePixelRatio || 1;
    pointerPos.current = { x: x / dpr, y: y / dpr };
    const viewSettings = getViewSettings(bookKey);
    const sel = doc.getSelection();
    const valid = !!sel && isValidSelection(sel);
    const corner = !viewSettings?.scrolled && valid ? pointerCornerNow() : null;
    noteCorner(corner, doc);
  };

  // Disengage and drop any pending corner page-turn (e.g. when the selection is
  // cleared).
  const cancelAutoTurn = () => {
    engagedCorner.current = null;
    if (autoTurnTimer.current) {
      clearTimeout(autoTurnTimer.current);
      autoTurnTimer.current = null;
    }
  };

  const handlePointerCancel = (_doc: Document, _index: number, ev: PointerEvent) => {
    // NB: don't cancel the auto-turn here — on Android pointercancel fires mid
    // edge-drag (browser takes over for scrolling), which is exactly when the
    // user is dragging into the corner. Cancel only on a real release.
    if (isInstantAnnotating.current) {
      stopInstantAnnotating(ev);
      handleInstantAnnotationPointerCancel();
    }
  };

  // Android (#1553): when a touch selection starts on the first word of a
  // hyphenated paragraph, Blink paints the start handle on the paragraph's
  // last hyphen and drag gestures re-anchor the selection base there. At
  // gesture end: restore the intended range if the anchor jumped, then clear
  // and re-add the selection through the Selection API — a selection that goes
  // empty for one painted frame loses its touch-handle visibility, so the
  // broken native handles disappear (the app's own handles take over) while
  // the highlight stays.
  const sanitizedGestureRef = useRef(false);
  const sanitizeAndroidHyphenSelection = async (doc: Document, index: number) => {
    if (sanitizedGestureRef.current) return;
    const sel = doc.getSelection();
    const win = doc.defaultView;
    if (!sel || !win || !isValidSelection(sel)) return;
    // Only act when THIS gesture produced a selection — a tap that merely
    // dismisses an existing selection must not re-assert it here.
    const initial = gestureInitialRef.current;
    if (!initial) return;
    const viewSettings = getViewSettings(bookKey);
    // The initial range is prone (long-press on the first word), or the
    // gesture dragged the selection start back onto a hyphenated paragraph
    // start (upward selection) — either way the painted start bound is bogus.
    const prone =
      initial.prone || isHyphenHandleBugProneRange(sel.getRangeAt(0), viewSettings?.vertical);
    if (!prone) return;
    sanitizedGestureRef.current = true;
    let finalRange = sel.getRangeAt(0);
    if (initial.prone) {
      const repaired = repairJumpedSelectionRange(sel, initial.node, initial.offset);
      if (repaired) finalRange = repaired;
    }
    guardProgrammaticSelection();
    sel.removeAllRanges();
    await new Promise<void>((resolve) =>
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())),
    );
    // A competing gesture may have touched the selection while we waited —
    // e.g. a tap collapses the old selection to a caret at the tapped point,
    // which can also mutate `finalRange` in place. Re-asserting then would
    // resurrect a stale (or collapsed) selection, so bail out instead.
    if (sel.rangeCount > 0 || finalRange.collapsed) {
      releaseProgrammaticSelection();
      return;
    }
    sel.addRange(finalRange);
    releaseProgrammaticSelection();
    await makeSelection(sel, index, false, true);
  };

  // Replace the live DOM selection from the custom selection handles. Guarded
  // so the resulting selectionchange echoes are ignored; a commit refreshes
  // the selection state (and thus the popup) once the drag ends.
  const applyProgrammaticSelection = async (range: Range, index: number, commit: boolean) => {
    const doc = range.startContainer.ownerDocument;
    const sel = doc?.getSelection();
    if (!doc || !sel) return;
    guardProgrammaticSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (commit) {
      releaseProgrammaticSelection();
      await makeSelection(sel, index, false, true);
    }
  };

  const handlePointerUp = async (doc: Document, index: number, ev?: PointerEvent) => {
    if (isInstantAnnotating.current && ev) {
      stopInstantAnnotating(ev);
      const handled = await handleInstantAnnotationPointerUp(doc, index, ev);
      if (handled) {
        isTextSelected.current = true;
        setTimeout(() => {
          isTextSelected.current = false;
        }, 200);
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

      // iOS no longer needs a special path: the native plugin
      // (ContextMenuSuppressor) suppresses the system selection menu, so
      // iOS selections go through the same path as desktop.
      if (isPointerInside) {
        isUpToPopup.current = true;
        makeSelection(sel, index, true);
      } else if (appService?.isAndroidApp) {
        isUpToPopup.current = false;
      }
    }

    if (osPlatform === 'android' && appService?.isAndroidApp) {
      await sanitizeAndroidHyphenSelection(doc, index);
    }
  };
  const handleTouchStart = () => {
    isTouchStarted.current = true;
    gestureInitialRef.current = null;
    sanitizedGestureRef.current = false;
  };
  const handleTouchMove = (ev: TouchEvent) => {
    if (isInstantAnnotating.current) {
      ev.preventDefault();
    }
  };
  const handleTouchEnd = () => {
    isTouchStarted.current = false;
  };

  // The corner the latest pointer (pointermove / native touchmove) position is in.
  const pointerCornerNow = (): Corner | null => {
    const p = pointerPos.current;
    return p ? cornerAt(p.x, p.y, readingAreaRect()) : null;
  };
  // The corner the selection caret (focus) is in.
  const caretCornerNow = (doc: Document): Corner | null => {
    const sel = doc.getSelection();
    if (!sel || !isValidSelection(sel)) return null;
    const pos = focusCaretWindowPos(doc, sel);
    return pos ? cornerAt(pos.x, pos.y, readingAreaRect()) : null;
  };
  // Whether any input signal (pointer/touch or caret) is currently in corner `c`.
  const inCorner = (c: Corner, doc: Document): boolean =>
    pointerCornerNow() === c || caretCornerNow(doc) === c;

  // Once a signal has stayed inside a corner for AUTO_TURN_DWELL_MS, turn one page
  // (#1354). One turn per engagement — a signal must leave the corner and return
  // to turn again (engagedCorner stays set after a turn so the dwell can't re-arm
  // while held).
  const armDwell = (corner: Corner, doc: Document) => {
    if (autoTurnTimer.current) return;
    autoTurnTimer.current = setTimeout(() => {
      autoTurnTimer.current = null;
      const sel = doc.getSelection();
      // Skip if the selection ended or every signal left the corner during the dwell.
      if (isAutoTurning.current || !sel || !isValidSelection(sel) || !inCorner(corner, doc)) return;

      // On Android an active selection pins the container scroll (issue #873 in
      // handleScroll). A deliberate page-turn IS a container scroll, so it gets
      // snapped straight back unless we suspend the pin for the turn and then
      // re-anchor it to the page we land on.
      isAutoTurning.current = true;
      // Logical next()/prev() so RTL books turn the correct way.
      const turning = corner === 'br' ? view?.next() : view?.prev();
      Promise.resolve(turning).finally(() => {
        selectionPosition.current = view?.renderer?.containerPosition ?? selectionPosition.current;
        isAutoTurning.current = false;
      });
    }, AUTO_TURN_DWELL_MS);
  };

  // Feed a corner detected from an input signal (pointer/touch/caret) into the
  // dwell state machine. Entering a corner arms the dwell; once no signal is in
  // the engaged corner any more it disengages so a re-entry can turn again.
  const noteCorner = (corner: Corner | null, doc: Document) => {
    if (isAutoTurning.current) return;
    if (corner) {
      if (engagedCorner.current !== corner) {
        engagedCorner.current = corner;
        armDwell(corner, doc);
      }
    } else if (engagedCorner.current && !inCorner(engagedCorner.current, doc)) {
      engagedCorner.current = null;
      if (autoTurnTimer.current) {
        clearTimeout(autoTurnTimer.current);
        autoTurnTimer.current = null;
      }
    }
  };

  const handleSelectionchange = (doc: Document, index: number) => {
    // Echo of our own programmatic selection writes (handle suppression or a
    // custom-handle drag) — not user input.
    if (programmaticSelectionRef.current) return;

    // Available on iOS, Android and Desktop, fired when the selection is changed.
    // On Android native app, this is the primary way to detect text selection.
    // On web with touch/pen in scroll mode, pointerup never fires (pointercancel
    // fires instead when browser takes over for scrolling), so we also handle
    // selectionchange for touch/pen input to pick up native text selections.
    const isAndroid = osPlatform === 'android' && appService?.isAndroidApp;
    const isTouchInput = lastPointerType.current === 'touch' || lastPointerType.current === 'pen';
    const sel = doc.getSelection() as Selection;
    const viewSettings = getViewSettings(bookKey);

    // First selection of an Android touch gesture: remember the anchor and
    // whether it is prone to the hyphen bounds bug (#1553), before any
    // drag-extension can corrupt it.
    if (isAndroid && !gestureInitialRef.current && isValidSelection(sel) && sel.anchorNode) {
      gestureInitialRef.current = {
        node: sel.anchorNode,
        offset: sel.anchorOffset,
        prone: isHyphenHandleBugProneRange(sel.getRangeAt(0), viewSettings?.vertical),
      };
    }

    // Auto page-turn (#1354): the selection caret is one of the engagement
    // signals on every platform (and the only one on Android during a native
    // selection drag, where pointer/touch-move don't fire). Feed it into the same
    // dwell machine the pointer uses.
    if (isValidSelection(sel)) {
      noteCorner(!viewSettings?.scrolled ? caretCornerNow(doc) : null, doc);
    } else {
      cancelAutoTurn();
    }

    if (!isAndroid && !isTouchInput) return;
    if (isValidSelection(sel)) {
      // On desktop with mouse, defer to pointerup for valid selections.
      if (!isAndroid && !isTouchInput) return;
      if (selectionPosition.current === null) {
        // Save the absolute container scroll, not `renderer.start` — the
        // latter is section-relative, so restoring it as `containerPosition`
        // snaps multi-section paginated views back to the first rendered
        // section (#873-related Android regression).
        selectionPosition.current = view?.renderer?.containerPosition ?? null;
      }
      makeSelection(sel, index, false);
    } else {
      // Selection cleared (e.g. clicking outside the selection).
      // Dismiss immediately on all platforms.
      if (isTextSelected.current) {
        handleDismissPopup();
        isTextSelected.current = false;
      }
      selectionPosition.current = null;
    }
  };
  const handleScroll = () => {
    // Prevent the container from scrolling when text is selected in paginated mode
    // FIXME: this is a workaround for issue #873
    if (osPlatform !== 'android' || !appService?.isAndroidApp) return;

    const viewSettings = getViewSettings(bookKey);
    if (viewSettings?.scrolled) return;

    // Don't fight a deliberate auto page-turn (#1354): without this the pin
    // below snaps the container straight back to the selection-start page and
    // the turn never sticks (the Android-only failure mode).
    if (isAutoTurning.current) return;

    if (isTextSelected.current && view?.renderer && selectionPosition.current !== null) {
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
      if (autoTurnTimer.current) clearTimeout(autoTurnTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isTextSelected,
    isInstantAnnotating,
    handleScroll,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handlePointerDown,
    handlePointerMove,
    handleNativeTouchMove,
    handlePointerCancel,
    handlePointerUp,
    handleSelectionchange,
    handleShowPopup,
    handleUpToPopup,
    handleContextmenu,
    applyProgrammaticSelection,
  };
};
