import { useEffect, useRef } from 'react';
import { BookNote } from '@/types/book';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import {
  focusCaretWindowPos,
  getWordRangeFromPoint,
  isHyphenHandleBugProneRange,
  isPointerInsideSelection,
  Point,
  rangeFromAnchorToPoint,
  repairJumpedSelectionRange,
  TextSelection,
} from '@/utils/sel';
import { Corner, useAutoPageTurn } from './useAutoPageTurn';
import { useInstantAnnotation } from './useInstantAnnotation';

// Instant-highlight quick action: on touch a plain tap and a swipe are both
// page-turn gestures, so the highlight must not engage on pointer-down or it
// swallows the tap/swipe (an Android tap-to-paginate regression). It only engages
// after the finger has held still on the text for this long; a tap releases first
// and a swipe moves first, so both fall through to pagination. Mouse input is not
// gated — a click vs. a press-drag is already unambiguous.
const INSTANT_HOLD_MS = 300;
// Movement past this many CSS px during the hold means the user is swiping, not
// settling in to highlight, so the pending engagement is cancelled.
const INSTANT_HOLD_MOVE_PX = 10;

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

  // Corner-dwell auto page-turn (#1354), now driven by every selection gesture
  // through a shared engagement point — see useAutoPageTurn.
  const {
    isAutoTurning,
    cornerAtPoint,
    noteCorner,
    noteAutoTurnPoint,
    cancel: cancelAutoTurn,
    onAfterTurn,
  } = useAutoPageTurn(bookKey, contentInsets);

  const isPopuped = useRef(false);
  const isUpToPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isTouchStarted = useRef(false);
  // A touch selectionchange deferred until the gesture ends: iOS streams
  // selectionchange while a finger drags the system selection handles, and
  // the Annotator hides the popup on every touchmove — re-showing it per
  // change made the annotation toolbar flash. Processed in handleTouchEnd.
  const pendingTouchSelection = useRef(false);
  const selectionPosition = useRef<number | null>(null);
  const lastPointerType = useRef<string>('mouse');
  // Whether a pointer drag (mouse/touch selection) is currently in progress.
  // Desktop selections defer to pointerup, but a keyboard selection adjustment
  // (#4728) has no pointer drag — handleSelectionchange uses this to refresh the
  // popup/range for keyboard-driven changes while still deferring mid-drag.
  const isPointerDown = useRef(false);
  const isInstantAnnotating = useRef(false);
  const isInstantAnnotated = useRef(false);
  const annotationStartPoint = useRef<Point | null>(null);
  // The element instant annotating set `user-select: none` on, so the exact same
  // element is restored on release (the pointerup target may differ once the
  // finger has moved across nodes).
  const instantAnnotationTarget = useRef<HTMLElement | null>(null);
  // Unsubscribe for the after-turn re-emit: while instant annotating, a corner
  // auto-turn rebuilds the preview from the held position onto the new page.
  const instantReemitUnsub = useRef<(() => void) | null>(null);
  // Pending instant-highlight still-hold (touch/pen). While a hold is in flight
  // these remember the press so the timer can engage at the same spot; the gate
  // is armed in handlePointerDown and dropped by a release or a swipe.
  const instantHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instantHoldTarget = useRef<HTMLElement | null>(null);
  const instantHoldStartClient = useRef<Point | null>(null);
  const instantHoldStartWindow = useRef<{ x: number; y: number } | null>(null);
  // Latest pointer position in window coords (from pointermove or, on Android,
  // native touchmove): an auto-turn engagement signal alongside the caret, and
  // the finger position the Android hyphen repair rebuilds from.
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
    handleInstantAnnotationEngage,
    handleInstantAnnotationPointerMove,
    handleInstantAnnotationPointerCancel,
    handleInstantAnnotationPointerUp,
    reapplyInstantAnnotation,
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

  const startInstantAnnotating = (target: HTMLElement, startPoint: Point) => {
    isInstantAnnotating.current = true;
    isInstantAnnotated.current = false;
    annotationStartPoint.current = startPoint;
    instantAnnotationTarget.current = target;
    if (view) view.renderer.scrollLocked = true;
    target.style.userSelect = 'none';
    instantReemitUnsub.current?.();
    instantReemitUnsub.current = onAfterTurn(() => reapplyInstantAnnotation());
  };

  const stopInstantAnnotating = () => {
    isInstantAnnotating.current = false;
    isInstantAnnotated.current = false;
    annotationStartPoint.current = null;
    if (view) view.renderer.scrollLocked = false;
    instantReemitUnsub.current?.();
    instantReemitUnsub.current = null;
    if (instantAnnotationTarget.current) {
      instantAnnotationTarget.current.style.userSelect = '';
      instantAnnotationTarget.current = null;
    }
  };

  // Drop a pending still-hold without engaging (tap released early, finger
  // swiped, or the gesture was cancelled).
  const cancelInstantHold = () => {
    if (instantHoldTimer.current) {
      clearTimeout(instantHoldTimer.current);
      instantHoldTimer.current = null;
    }
    instantHoldTarget.current = null;
    instantHoldStartClient.current = null;
    instantHoldStartWindow.current = null;
  };

  // Begin the touch still-hold: engage the instant annotation only once the
  // finger has stayed put on the text for INSTANT_HOLD_MS. preventDefault is NOT
  // called here, so a tap or swipe that bows out keeps its native page-turn.
  // The native long-press selection needs no suppression here: instant mode
  // makes the content non-selectable at the stylesheet level (getStyles) —
  // JS-applied user-select at pointer-down proved too late for iOS WebKit's
  // long-press recognizer.
  const armInstantHold = (doc: Document, index: number, ev: PointerEvent) => {
    const feRect = doc.defaultView?.frameElement?.getBoundingClientRect();
    instantHoldTarget.current = ev.target as HTMLElement;
    instantHoldStartClient.current = { x: ev.clientX, y: ev.clientY };
    instantHoldStartWindow.current = {
      x: ev.clientX + (feRect?.left ?? 0),
      y: ev.clientY + (feRect?.top ?? 0),
    };
    if (instantHoldTimer.current) clearTimeout(instantHoldTimer.current);
    instantHoldTimer.current = setTimeout(() => {
      instantHoldTimer.current = null;
      const target = instantHoldTarget.current;
      const startClient = instantHoldStartClient.current;
      const start = instantHoldStartWindow.current;
      const now = pointerPos.current;
      cancelInstantHold();
      if (!target || !startClient) return;
      // Backstop the move-driven cancel: if the finger drifted during the hold,
      // treat it as a swipe and bow out.
      if (start && now && Math.hypot(now.x - start.x, now.y - start.y) > INSTANT_HOLD_MOVE_PX) {
        handleInstantAnnotationPointerCancel();
        return;
      }
      startInstantAnnotating(target, startClient);
      // Preview the word under the finger right away (the feedback the
      // suppressed system long-press selection used to give); a release
      // without a drag commits it and opens the range editor.
      handleInstantAnnotationEngage(doc, index);
    }, INSTANT_HOLD_MS);
  };

  // While a still-hold is pending, a move past the threshold means the user is
  // swiping to turn the page — cancel so the swipe isn't swallowed.
  const maybeCancelInstantHoldOnMove = () => {
    const start = instantHoldStartWindow.current;
    const now = pointerPos.current;
    if (!instantHoldTimer.current || !start || !now) return;
    if (Math.hypot(now.x - start.x, now.y - start.y) > INSTANT_HOLD_MOVE_PX) {
      cancelInstantHold();
      handleInstantAnnotationPointerCancel();
    }
  };

  const handlePointerDown = (doc: Document, index: number, ev: PointerEvent) => {
    lastPointerType.current = ev.pointerType;
    isPointerDown.current = true;

    if (isInstantAnnotationEnabled()) {
      const eligible = handleInstantAnnotationPointerDown(doc, index, ev);
      if (!eligible) return;
      const isTouch = ev.pointerType === 'touch' || ev.pointerType === 'pen';
      if (isTouch) {
        // Touch: gate behind a still hold so a tap or swipe still turns the page.
        armInstantHold(doc, index, ev);
      } else {
        // Mouse: a press-drag is an unambiguous highlight intent; engage at once.
        ev.preventDefault();
        startInstantAnnotating(ev.target as HTMLElement, { x: ev.clientX, y: ev.clientY });
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
    maybeCancelInstantHoldOnMove();
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
          stopInstantAnnotating();
          handleInstantAnnotationPointerCancel();
          return;
        }
      }
      ev.preventDefault();
      isInstantAnnotated.current = handleInstantAnnotationPointerMove(doc, index, ev);
      // Cross-page instant highlight: feed the finger corner into the same dwell
      // machine native selection uses, so the page turns and the highlight
      // continues across the boundary (the start is DOM-anchored in
      // useInstantAnnotation so it survives the scroll).
      noteAutoTurnPoint(getViewSettings(bookKey)?.scrolled ? null : pointerPos.current);
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
    noteCorner(corner, (c) => inCorner(c, doc));
  };

  // Android native touchmove — the pointer engagement signal during a native
  // selection drag (the iframe pointermove doesn't fire there). The native x/y
  // are physical device pixels relative to the window; convert to CSS px.
  const handleNativeTouchMove = (x: number, y: number, doc: Document) => {
    const dpr = window.devicePixelRatio || 1;
    pointerPos.current = { x: x / dpr, y: y / dpr };
    maybeCancelInstantHoldOnMove();
    const viewSettings = getViewSettings(bookKey);
    // Instant highlight has no DOM selection (user-select is off); feed the
    // finger corner directly so the drag can turn the page across boundaries.
    if (isInstantAnnotating.current) {
      noteAutoTurnPoint(viewSettings?.scrolled ? null : pointerPos.current);
      return;
    }
    const sel = doc.getSelection();
    const valid = !!sel && isValidSelection(sel);
    const corner = !viewSettings?.scrolled && valid ? pointerCornerNow() : null;
    noteCorner(corner, (c) => inCorner(c, doc));
  };

  const handlePointerCancel = (_doc: Document, _index: number, _ev: PointerEvent) => {
    isPointerDown.current = false;
    // A pending still-hold that never engaged: drop it so a swipe-takeover
    // (Android fires pointercancel when the browser starts scrolling) keeps its
    // native page-turn instead of being swallowed.
    cancelInstantHold();
    // NB: don't cancel the auto-turn here — on Android pointercancel fires mid
    // edge-drag (browser takes over for scrolling), which is exactly when the
    // user is dragging into the corner. Cancel only on a real release.
    if (isInstantAnnotating.current) {
      stopInstantAnnotating();
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
      // The corrupted drag can leave EITHER selection end at the bogus bound
      // (base re-anchor or extent overshoot). The trustworthy facts are the
      // gesture-initial anchor and the finger position (pointerPos, reset at
      // touchstart and fed by native touchmove): rebuild between those when
      // the gesture moved; otherwise fall back to the anchor-jump repair.
      const p = pointerPos.current;
      const feRect = win.frameElement?.getBoundingClientRect();
      const clamped = p
        ? rangeFromAnchorToPoint(
            doc,
            initial.node,
            initial.offset,
            p.x - (feRect?.left ?? 0),
            p.y - (feRect?.top ?? 0),
          )
        : null;
      const repaired = clamped ?? repairJumpedSelectionRange(sel, initial.node, initial.offset);
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

  // A double-click / touch double-tap on a word: select the word (like a
  // long-press selection) and route it through the same selection state that
  // drives the quick action / annotation toolbar. On desktop the browser already
  // selects the word natively on a real double-click, and that selection flows
  // through handlePointerUp; so we only synthesize the selection when nothing is
  // selected yet — the touch double-tap case (Android has no native word-select
  // gesture), where the dblclick is detected from two quick taps.
  const handleDoubleClick = async (doc: Document, index: number, x: number, y: number) => {
    if (isInstantAnnotating.current) return;
    const sel = doc.getSelection();
    if (!sel || isValidSelection(sel)) return;
    const range = getWordRangeFromPoint(doc, x, y);
    if (!range) return;
    guardProgrammaticSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    releaseProgrammaticSelection();
    // With the instant-highlight stylesheet suppression active, WebKit may
    // refuse the programmatic selection on non-selectable content.
    if (sel.rangeCount === 0) return;
    // No isUpToPopup latch here: a double-tap is two taps both consumed by the
    // double-click detection, so no trailing single-click follows that would
    // dismiss the popup — the next deliberate tap should dismiss it normally.
    await makeSelection(sel, index, false);
  };

  const handlePointerUp = async (doc: Document, index: number, ev?: PointerEvent) => {
    isPointerDown.current = false;
    // A tap (or a long-press shorter than the hold) that never engaged: drop the
    // pending still-hold so the tap falls through to a page turn.
    if (instantHoldTimer.current) cancelInstantHold();
    if (isInstantAnnotating.current && ev) {
      stopInstantAnnotating();
      const handled = await handleInstantAnnotationPointerUp(doc, index, ev);
      if (handled === 'editor') {
        // The hold committed a word highlight and left the range editor open.
        // Consume the trailing click with the "this release leads to a popup"
        // latch (same as the selection popup flow) — the 200ms isTextSelected
        // latch below would let the click dismiss the fresh editor instead.
        isUpToPopup.current = true;
        return;
      }
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
    pendingTouchSelection.current = false;
    gestureInitialRef.current = null;
    sanitizedGestureRef.current = false;
    // Pointer positions are per-gesture: a stale point from a previous touch
    // must not steer this gesture's selection repair. Touch moves re-feed it.
    pointerPos.current = null;
  };
  const handleTouchMove = (ev: TouchEvent) => {
    if (isInstantAnnotating.current) {
      ev.preventDefault();
    }
  };
  // Ends the touch gesture and processes a selectionchange that was deferred
  // while the finger was down (see handleSelectionchange): the selection state
  // updates once, so the annotation popup appears once, at the release. The
  // Android native-touch bridge calls this without a doc (it never defers).
  const handleTouchEnd = (doc?: Document, index?: number) => {
    isTouchStarted.current = false;
    if (!pendingTouchSelection.current) return;
    pendingTouchSelection.current = false;
    if (!doc || index === undefined) return;
    const sel = doc.getSelection();
    if (sel && isValidSelection(sel)) {
      if (selectionPosition.current === null) {
        selectionPosition.current = view?.renderer?.containerPosition ?? null;
      }
      makeSelection(sel, index, false);
    } else if (isTextSelected.current) {
      handleDismissPopup();
      isTextSelected.current = false;
    }
  };

  // The corner the latest pointer (pointermove / native touchmove) position is in.
  const pointerCornerNow = (): Corner | null => cornerAtPoint(pointerPos.current);
  // The corner the selection caret (focus) is in.
  const caretCornerNow = (doc: Document): Corner | null => {
    const sel = doc.getSelection();
    if (!sel || !isValidSelection(sel)) return null;
    return cornerAtPoint(focusCaretWindowPos(doc, sel));
  };
  // Whether any input signal (pointer/touch or caret) is currently in corner `c`.
  // Injected into the dwell machine as the native-selection liveness predicate so
  // the page only turns while the caret OR the finger is still in the corner.
  const inCorner = (c: Corner, doc: Document): boolean =>
    pointerCornerNow() === c || caretCornerNow(doc) === c;

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
      noteCorner(!viewSettings?.scrolled ? caretCornerNow(doc) : null, (c) => inCorner(c, doc));
    } else {
      cancelAutoTurn();
    }

    // Desktop mouse selections defer to pointerup, but a keyboard selection
    // adjustment (#4728) has no pointerup — process it as long as a pointer drag
    // isn't in progress (mid-drag still defers to pointerup).
    if (!isAndroid && !isTouchInput && isPointerDown.current) return;
    // Touch drags in paginated mode (iOS/web): the system handle drag streams
    // selectionchange while the Annotator's touchmove handler hides the popup;
    // processing each change re-showed it and made the toolbar flash. Defer to
    // the gesture end (handleTouchEnd). Scroll mode keeps the immediate path —
    // there the gesture can end in pointercancel with no processing after it.
    // Android keeps it too: selectionchange is its primary selection signal
    // and its popup-hiding touchmove never fires.
    if (!isAndroid && isTouchInput && isTouchStarted.current && !viewSettings?.scrolled) {
      pendingTouchSelection.current = true;
      return;
    }
    if (isValidSelection(sel)) {
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
    // After any auto page-turn, re-anchor the Android selection scroll-pin to the
    // page we landed on (the #873 pin in handleScroll). Harmless when nothing is
    // pinned (instant highlight / range editors carry no DOM selection).
    const unsubAfterTurn = onAfterTurn(() => {
      selectionPosition.current =
        getView(bookKey)?.renderer?.containerPosition ?? selectionPosition.current;
    });
    return () => {
      eventDispatcher.offSync('iframe-single-click', handleSingleClick);
      unsubAfterTurn();
      if (instantHoldTimer.current) clearTimeout(instantHoldTimer.current);
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
    handleDoubleClick,
    handleSelectionchange,
    handleShowPopup,
    handleUpToPopup,
    handleContextmenu,
    applyProgrammaticSelection,
    // The shared corner auto-turn feed/cancel/subscribe, re-exposed so the range
    // editors can drive the same machine from their overlay handle drags.
    noteAutoTurnPoint,
    cancelAutoTurn,
    onAutoTurn: onAfterTurn,
  };
};
