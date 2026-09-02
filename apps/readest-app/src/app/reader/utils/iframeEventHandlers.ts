import { DOUBLE_CLICK_INTERVAL_THRESHOLD_MS, LONG_HOLD_THRESHOLD } from '@/services/constants';
import { eventDispatcher } from '@/utils/event';
import { findGlossWord } from '@/app/reader/utils/wordlensRuby';
import { TURN_GESTURE_LEFT_INSET_ATTRIBUTE } from './brightnessGesture';
import { dispatchTouchInterceptors, type TouchDetail } from '../hooks/useTouchInterceptor';
import {
  createTurnGestureIntent,
  NATIVE_CAPTURED_TURN_ATTRIBUTE,
  NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE,
  shouldClaimTurnGesture,
  TURN_EDGE_ZONE_RATIO,
  type TurnGestureIntent,
} from './turnGestureArena';

let lastClickTime = 0;
let longHoldTimeout: ReturnType<typeof setTimeout> | null = null;
let isMouseDown = false;
interface NativeTurnHost extends HTMLElement {
  scrollLocked?: boolean;
}
interface TouchGesture {
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  touchPanClaimed: boolean;
  interceptorConsumed: boolean;
  turnHost?: NativeTurnHost;
  turnIntent?: TurnGestureIntent;
}
interface PanAxes {
  horizontal: boolean;
  vertical: boolean;
}
interface SerializedTouch {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}
interface MousePanGesture {
  startX: number;
  startY: number;
  horizontal: boolean;
  vertical: boolean;
  claimed: boolean;
}
const touchGestures = new Map<string, TouchGesture>();
const suppressedSwipeClicks = new Map<string, { until: number; endX: number; endY: number }>();
interface LayeredTurnTouchClaim {
  claimed: boolean;
  ended: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}
const layeredTurnTouchClaims = new Map<string, LayeredTurnTouchClaim>();
const SYNTHESIZED_CLICK_SWIPE_DISTANCE_PX = 15;
const SYNTHESIZED_CLICK_SUPPRESSION_MS = 750;
const SYNTHESIZED_CLICK_POSITION_SLOP_PX = 15;
const TOUCH_PAN_THRESHOLD_PX = 6;
// Match the touch-tool claim distance before latching the browser into a
// fixed-layout pan, so tools can arbitrate the gesture first.
const RAW_TOUCH_PAN_THRESHOLD_PX = 10;

const getNativeTurnHost = (event: TouchEvent): NativeTurnHost | null => {
  const currentTarget = event.currentTarget as Document | null;
  if (currentTarget?.nodeType !== 9) return null;
  const frame = currentTarget.defaultView?.frameElement;
  const root = frame?.getRootNode();
  const host = root && 'host' in root ? (root.host as NativeTurnHost) : null;
  if (
    host?.localName !== 'foliate-paginator' ||
    !host.hasAttribute(NATIVE_CAPTURED_TURN_ATTRIBUTE) ||
    host.hasAttribute(NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE)
  ) {
    return null;
  }
  return host;
};

const createNativeTurnIntent = (
  event: TouchEvent,
  touch: { screenX: number },
): { host: NativeTurnHost; intent: TurnGestureIntent } | null => {
  const host = getNativeTurnHost(event);
  if (!host?.getBoundingClientRect) return null;
  const currentTarget = event.currentTarget as Document;
  const selection = currentTarget.getSelection?.();
  if (selection && !selection.isCollapsed) return null;

  const rect = host.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const windowScreenX = Number.isFinite(window.screenX) ? window.screenX : 0;
  const localStartX = touch.screenX - windowScreenX - rect.left;
  const inset = Number(host.getAttribute(TURN_GESTURE_LEFT_INSET_ATTRIBUTE));
  const reservedLeftRatio = Number.isFinite(inset) ? Math.max(0, Math.min(0.5, inset)) : 0;
  const earlyClaimBlocked = localStartX <= rect.width * reservedLeftRatio;
  let edgeDirection: -1 | 0 | 1 = 0;
  if (!earlyClaimBlocked && localStartX >= 0 && localStartX <= rect.width * TURN_EDGE_ZONE_RATIO) {
    edgeDirection = 1;
  } else if (localStartX <= rect.width && localStartX >= rect.width * (1 - TURN_EDGE_ZONE_RATIO)) {
    edgeDirection = -1;
  }
  return {
    host,
    intent: createTurnGestureIntent(edgeDirection, earlyClaimBlocked, 0),
  };
};

interface FixedLayoutRenderer extends HTMLElement {
  scrolled?: boolean;
  isOverflowX?: boolean;
  isOverflowY?: boolean;
}

// The iframe can inspect its fixed-layout renderer synchronously. This avoids
// waiting for the parent realm's postMessage when deciding whether to cancel a
// native touch/mouse gesture on its first move.
const getRawFixedLayoutPanAxes = (event: Event): PanAxes | null | undefined => {
  const currentTarget = event.currentTarget as Document | null;
  const frame = currentTarget?.defaultView?.frameElement;
  const root = frame?.getRootNode();
  const renderer =
    root && 'host' in root ? ((root as ShadowRoot).host as FixedLayoutRenderer) : null;
  if (!renderer) return undefined;
  if (renderer.localName === 'foliate-paginator') return null;
  if (renderer.localName !== 'foliate-fxl' || renderer.scrolled) return null;
  const axes = {
    horizontal: renderer.isOverflowX === true,
    vertical: renderer.isOverflowY === true,
  };
  return axes.horizontal || axes.vertical ? axes : null;
};

// Middle-click autoscroll (#4951). Books where the feature is armed (desktop
// app, scrolled mode, setting on) get the middle button's defaults suppressed,
// so the WebView's own autoscroll (WebView2) can't scroll alongside ours and a
// middle-clicked link doesn't open. These handlers run in the main realm, so
// the hook toggles this state directly.
const autoscrollArmedBooks = new Set<string>();
// Fixed-layout mouse panning needs the iframe's move stream while the pointer
// is inside the browsing context. The parent window listener takes over once
// the pointer leaves the iframe, so this map is deliberately separate from the
// middle-click autoscroll state.
const mousePanArmedBooks = new Map<string, PanAxes>();
const mousePanClaimedBooks = new Set<string>();
const mousePanGestures = new Map<string, MousePanGesture>();
// Fixed-layout touch panning needs the raw iframe touchmove listener to cancel
// the browser's default gesture synchronously, before the postMessage reaches
// React. The actual axis/scroll operation remains in useTouchEvent.
const touchPanArmedBooks = new Map<string, PanAxes>();
// Whether an autoscroll session is running; gates mousemove forwarding so the
// stream costs nothing while idle.
let autoscrollTracking = false;

export const setMousePanArmed = (
  bookKey: string,
  armed: boolean,
  axes: PanAxes = { horizontal: true, vertical: true },
) => {
  if (armed) mousePanArmedBooks.set(bookKey, axes);
  else {
    mousePanArmedBooks.delete(bookKey);
    mousePanGestures.delete(bookKey);
    mousePanClaimedBooks.delete(bookKey);
  }
};

export const setMousePanClaimed = (bookKey: string, claimed: boolean) => {
  if (claimed) mousePanClaimedBooks.add(bookKey);
  else mousePanClaimedBooks.delete(bookKey);
};

export const setTouchPanArmed = (
  bookKey: string,
  armed: boolean,
  axes: PanAxes = { horizontal: true, vertical: true },
) => {
  if (armed) touchPanArmedBooks.set(bookKey, axes);
  else touchPanArmedBooks.delete(bookKey);
};

export const resetMouseDownState = () => {
  isMouseDown = false;
};

export const resetMouseSession = () => {
  isMouseDown = false;
  mousePanArmedBooks.clear();
  mousePanClaimedBooks.clear();
  mousePanGestures.clear();
  if (longHoldTimeout) {
    clearTimeout(longHoldTimeout);
    longHoldTimeout = null;
  }
};

export const setAutoscrollArmed = (bookKey: string, armed: boolean) => {
  if (armed) autoscrollArmedBooks.add(bookKey);
  else autoscrollArmedBooks.delete(bookKey);
};

export const setAutoscrollTracking = (tracking: boolean) => {
  autoscrollTracking = tracking;
};

// Fixed-layout mouse panning owns the compatibility click after a claimed drag.
export const suppressMousePanClick = (bookKey: string, endX: number, endY: number) => {
  suppressedSwipeClicks.set(bookKey, {
    until: Date.now() + SYNTHESIZED_CLICK_SUPPRESSION_MS,
    endX,
    endY,
  });
};

const tryClaimMousePan = (
  bookKey: string,
  gesture: MousePanGesture,
  axes: PanAxes | null | undefined,
  screenX: number,
  screenY: number,
) => {
  if (gesture.claimed) return true;
  if (!axes) return false;
  const deltaX = screenX - gesture.startX;
  const deltaY = screenY - gesture.startY;
  if (Math.hypot(deltaX, deltaY) < TOUCH_PAN_THRESHOLD_PX) return false;
  const horizontal = axes.horizontal && Math.abs(deltaX) >= Math.abs(deltaY);
  const vertical = axes.vertical && Math.abs(deltaY) > Math.abs(deltaX);
  if (!horizontal && !vertical) return false;
  gesture.horizontal = horizontal;
  gesture.vertical = vertical;
  gesture.claimed = true;
  mousePanClaimedBooks.add(bookKey);
  return true;
};

// A layered turn can now claim below the generic 15px swipe threshold. Keep
// synthesized-click suppression tied to the authoritative gesture claim so a
// valid early turn cannot be replayed as a toolbar click after touchend.
export const setLayeredTurnTouchClaimed = (bookKey: string, claimed: boolean) => {
  if (!claimed) {
    const previous = layeredTurnTouchClaims.get(bookKey);
    if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer);
    layeredTurnTouchClaims.delete(bookKey);
    return;
  }
  const state = layeredTurnTouchClaims.get(bookKey) ?? { claimed: false, ended: false };
  state.claimed = true;
  layeredTurnTouchClaims.set(bookKey, state);
};

/** Start a fresh raw/direct touch lifetime for layered-turn ownership. */
export const beginLayeredTurnTouch = (bookKey: string) => {
  const previous = layeredTurnTouchClaims.get(bookKey);
  if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer);
  layeredTurnTouchClaims.set(bookKey, { claimed: false, ended: false });
};

/**
 * Seal a completed touch while retaining a claimed gesture briefly enough to
 * suppress the browser's delayed compatibility click. This is idempotent
 * because iframe events and the parent React surface can observe the same
 * physical release.
 */
export const endLayeredTurnTouch = (bookKey: string) => {
  const state = layeredTurnTouchClaims.get(bookKey);
  if (!state || state.ended) return;
  state.ended = true;
  state.cleanupTimer = setTimeout(() => {
    if (layeredTurnTouchClaims.get(bookKey) === state) {
      layeredTurnTouchClaims.delete(bookKey);
    }
  }, SYNTHESIZED_CLICK_SUPPRESSION_MS);
};

/** Cancel a touch without retaining synthesized-click suppression state. */
export const cancelLayeredTurnTouch = (bookKey: string) => {
  setLayeredTurnTouchClaimed(bookKey, false);
};

// The forwarded iframe lifecycle is independent of app-interceptor priority,
// so it is more reliable than any one interceptor's local start/end state for
// ordinary page-turn candidates. A capture-phase owner may still suppress a
// later forwarded event; the next touchstart always replaces stale state.
export const isLayeredTurnTouchActive = (bookKey: string) => {
  const state = layeredTurnTouchClaims.get(bookKey);
  return !!state && !state.ended;
};

const clearLayeredTurnTouchClaim = (bookKey: string) => {
  cancelLayeredTurnTouch(bookKey);
};

const suppressDomClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopImmediatePropagation();
};

const consumeSuppressedDomClick = (bookKey: string, event: MouseEvent, now: number) => {
  const suppressedSwipe = suppressedSwipeClicks.get(bookKey);
  if (suppressedSwipe) {
    if (now > suppressedSwipe.until) {
      suppressedSwipeClicks.delete(bookKey);
    } else {
      const nearEnd =
        Math.hypot(event.screenX - suppressedSwipe.endX, event.screenY - suppressedSwipe.endY) <=
        SYNTHESIZED_CLICK_POSITION_SLOP_PX;
      if (nearEnd) {
        suppressedSwipeClicks.delete(bookKey);
        clearLayeredTurnTouchClaim(bookKey);
        suppressDomClick(event);
        return true;
      }
    }
  }
  const layeredClaim = layeredTurnTouchClaims.get(bookKey);
  if (layeredClaim?.claimed && layeredClaim.ended) {
    clearLayeredTurnTouchClaim(bookKey);
    suppressDomClick(event);
    return true;
  }
  return false;
};

// Runs before Foliate's bubble-phase link handler. Only recognized swipes are
// intercepted here; ordinary clicks retain their existing listener order and
// link/media/footnote behavior.
export const handleClickCapture = (bookKey: string, event: MouseEvent) => {
  consumeSuppressedDomClick(bookKey, event, Date.now());
};

// The event's position in main-window viewport coordinates: iframe client
// coordinates offset by the frame's on-screen rect. The rect already includes
// any zoom transform on the frame's ancestors, so client sizes are rescaled.
const getWindowPoint = (event: MouseEvent) => {
  const win = event.view;
  const frame = win?.frameElement;
  if (!win || !frame) return { windowX: event.clientX, windowY: event.clientY };
  const rect = frame.getBoundingClientRect();
  const { clientWidth, clientHeight } = win.document.documentElement;
  const scaleX = clientWidth ? rect.width / clientWidth : 1;
  const scaleY = clientHeight ? rect.height / clientHeight : 1;
  return {
    windowX: rect.left + event.clientX * scaleX,
    windowY: rect.top + event.clientY * scaleY,
  };
};

let keyboardState = {
  key: '',
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
};

const getKeyStatus = (event?: MouseEvent | WheelEvent | TouchEvent) => {
  if (event && 'ctrlKey' in event) {
    return {
      key: keyboardState.key,
      code: keyboardState.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
  }
  return {
    ...keyboardState,
  };
};

export const handleKeydown = (bookKey: string, event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const interactiveTarget =
    !!target?.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '') ||
    (/^(A|BUTTON)$/.test(target?.tagName ?? '') && (event.key === 'Enter' || event.key === ' '));
  const postKeydown = (handled: boolean) => {
    window.postMessage(
      {
        type: 'iframe-keydown',
        bookKey,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        altGraphKey: event.getModifierState('AltGraph'),
        repeat: event.repeat,
        interactiveTarget,
        handled,
      },
      '*',
    );
  };
  keyboardState = {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };

  if (['Backspace'].includes(event.key)) {
    event.preventDefault();
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
  }

  // The original iframe KeyboardEvent must be consumed synchronously. A later
  // postMessage handler cannot cancel browser defaults such as Ctrl+End.
  if (eventDispatcher.dispatchSync('iframe-page-turn-keydown', { bookKey, event })) {
    event.preventDefault();
    event.stopImmediatePropagation();
    postKeydown(true);
    return;
  }

  if (eventDispatcher.dispatchSync('iframe-shortcut-keydown', { bookKey, event })) {
    event.preventDefault();
    event.stopImmediatePropagation();
    postKeydown(true);
    return;
  }

  postKeydown(false);
};

export const handleKeyup = (bookKey: string, event: KeyboardEvent) => {
  keyboardState = {
    key: '',
    code: '',
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };

  window.postMessage(
    {
      type: 'iframe-keyup',
      bookKey,
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    },
    '*',
  );
};

export const handleMousedown = (bookKey: string, event: MouseEvent) => {
  isMouseDown = true;
  if (longHoldTimeout) clearTimeout(longHoldTimeout);
  longHoldTimeout = setTimeout(() => {
    longHoldTimeout = null;
  }, LONG_HOLD_THRESHOLD);

  if (event.button === 0) {
    mousePanClaimedBooks.delete(bookKey);
    const rawAxes = getRawFixedLayoutPanAxes(event);
    if (rawAxes !== undefined) {
      setMousePanArmed(
        bookKey,
        rawAxes !== null,
        rawAxes ?? { horizontal: false, vertical: false },
      );
    }
    const hasTextSelection = Boolean(event.view?.getSelection?.()?.isCollapsed === false);
    const axes = rawAxes === undefined ? mousePanArmedBooks.get(bookKey) : rawAxes;
    if (
      !hasTextSelection &&
      axes !== null &&
      Number.isFinite(event.screenX) &&
      Number.isFinite(event.screenY)
    ) {
      mousePanGestures.set(bookKey, {
        startX: event.screenX,
        startY: event.screenY,
        horizontal: false,
        vertical: false,
        claimed: false,
      });
    } else {
      mousePanGestures.delete(bookKey);
    }
  }

  if (event.button === 1 && autoscrollArmedBooks.has(bookKey)) {
    event.preventDefault();
  }
  if (event.button === 3 || event.button === 4) event.preventDefault();

  window.postMessage(
    {
      type: 'iframe-mousedown',
      bookKey,
      button: event.button,
      buttons: event.buttons,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
      hasTextSelection: Boolean(event.view?.getSelection?.()?.isCollapsed === false),
      // Anchor point for the autoscroll indicator, which renders in the parent.
      ...(event.button === 1 ? getWindowPoint(event) : null),
      ...getKeyStatus(event),
    },
    '*',
  );
};

export const handleAuxclick = (bookKey: string, event: MouseEvent) => {
  // Swallow the middle button's auxclick while autoscroll is armed so a
  // middle-clicked link doesn't also navigate or open elsewhere.
  if (event.button === 1 && autoscrollArmedBooks.has(bookKey)) {
    event.preventDefault();
  }
  if (event.button === 3 || event.button === 4) event.preventDefault();
};

export const handleMousemove = (bookKey: string, event: MouseEvent) => {
  const gesture = mousePanGestures.get(bookKey);
  if (event.buttons === 0) {
    isMouseDown = false;
    mousePanGestures.delete(bookKey);
    mousePanClaimedBooks.delete(bookKey);
  }

  let rawPanClaimed = false;
  if (
    gesture &&
    event.buttons != null &&
    (event.buttons & 1) !== 0 &&
    Number.isFinite(event.screenX) &&
    Number.isFinite(event.screenY)
  ) {
    const rawAxes = getRawFixedLayoutPanAxes(event);
    const axes = rawAxes === undefined ? mousePanArmedBooks.get(bookKey) : rawAxes;
    rawPanClaimed = tryClaimMousePan(bookKey, gesture, axes, event.screenX, event.screenY);
  }

  if (
    !autoscrollTracking &&
    !mousePanArmedBooks.has(bookKey) &&
    !gesture?.claimed &&
    !mousePanClaimedBooks.has(bookKey)
  ) {
    return;
  }
  if (
    (rawPanClaimed || mousePanClaimedBooks.has(bookKey)) &&
    (event.buttons == null || (event.buttons & 1) !== 0)
  ) {
    event.preventDefault();
  }
  window.postMessage(
    {
      type: 'iframe-mousemove',
      bookKey,
      buttons: event.buttons,
      screenX: event.screenX,
      screenY: event.screenY,
    },
    '*',
  );
};

export const handleMouseup = (bookKey: string, event: MouseEvent) => {
  isMouseDown = false;
  const gesture = mousePanGestures.get(bookKey);
  if (event.button === 0) {
    const rawAxes = getRawFixedLayoutPanAxes(event);
    const axes = rawAxes === undefined ? mousePanArmedBooks.get(bookKey) : rawAxes;
    const claimed =
      gesture &&
      Number.isFinite(event.screenX) &&
      Number.isFinite(event.screenY) &&
      tryClaimMousePan(bookKey, gesture, axes, event.screenX, event.screenY);
    if (claimed || mousePanClaimedBooks.has(bookKey)) {
      suppressMousePanClick(bookKey, event.screenX, event.screenY);
      event.preventDefault();
    }
    mousePanGestures.delete(bookKey);
    mousePanClaimedBooks.delete(bookKey);
  }
  // we will handle mouse back and forward buttons ourselves
  if ([3, 4].includes(event.button)) {
    event.preventDefault();
    if (eventDispatcher.dispatchSync('iframe-shortcut-mouseup', { bookKey, event })) {
      event.stopImmediatePropagation();
      return;
    }
  }
  window.postMessage(
    {
      type: 'iframe-mouseup',
      bookKey,
      button: event.button,
      buttons: event.buttons,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
      ...getKeyStatus(event),
    },
    '*',
  );
};

export const handleWheel = (bookKey: string, event: WheelEvent) => {
  window.postMessage(
    {
      type: 'iframe-wheel',
      bookKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
      ...getKeyStatus(event),
    },
    '*',
  );
};

// A tappable media element under the pointer, resolved to the payload the image
// gallery / table zoom viewers consume.
type MediaTarget = { elementType: 'image'; src: string } | { elementType: 'table'; html: string };

const detectMediaTarget = (target: HTMLElement | null): MediaTarget | null => {
  if (!target) return null;
  if (target.localName === 'img') {
    return { elementType: 'image', src: (target as HTMLImageElement).src };
  }
  const svgImage = target.closest('svg')?.querySelector('image');
  if (svgImage) {
    const href =
      svgImage.getAttribute('href') ||
      svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href) return { elementType: 'image', src: href };
  }
  const table = target.localName === 'table' ? target : target.closest('table');
  if (table) return { elementType: 'table', html: (table as HTMLElement).outerHTML };
  return null;
};

export const handleClick = (
  bookKey: string,
  doubleClickDisabled: React.MutableRefObject<boolean>,
  isFixedLayout: boolean,
  isComicBook: boolean,
  event: MouseEvent,
) => {
  const now = Date.now();
  if (consumeSuppressedDomClick(bookKey, event, now)) return;

  if (!doubleClickDisabled.current && now - lastClickTime < DOUBLE_CLICK_INTERVAL_THRESHOLD_MS) {
    lastClickTime = now;
    // A comic page is one full-bleed image with no text on it, so the
    // double-click that starts a word selection everywhere else is free to do
    // what a single tap does in a reflowable book: open the page in the image
    // viewer, the only surface that can zoom past page-fit and save/share the
    // image. Single tap cannot be used here - in fixed layout it is the
    // page-turn / toolbar gesture.
    const comicPage = isComicBook ? detectMediaTarget(event.target as HTMLElement | null) : null;
    if (comicPage?.elementType === 'image') {
      window.postMessage({ type: 'iframe-open-media', bookKey, ...comicPage }, '*');
      return;
    }
    window.postMessage(
      {
        type: 'iframe-double-click',
        bookKey,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: event.offsetX,
        offsetY: event.offsetY,
        ...getKeyStatus(event),
      },
      '*',
    );
    return;
  }

  lastClickTime = now;

  const postSingleClick = () => {
    // Native captured-turn recognition is delivered through postMessage and
    // can land one task after the iframe touchend/click. Re-check ownership at
    // dispatch time so an early 1–6px claim cannot slip through that gap.
    const lateLayeredClaim = layeredTurnTouchClaims.get(bookKey);
    if (lateLayeredClaim?.claimed && lateLayeredClaim.ended) {
      clearLayeredTurnTouchClaim(bookKey);
      if (lastClickTime === now) lastClickTime = 0;
      return;
    }
    const element = event.target as HTMLElement | null;
    const footnoteSelector = [
      '.js_readerFooterNote',
      '.zhangyue-footnote',
      '.duokan-footnote',
      '.qqreader-footnote',
    ].join(', ');
    const footnote = element?.closest(footnoteSelector);
    // In reflowable books a single tap on an image/table opens the media
    // viewer. A media element wrapped in a plain link (e.g. a figure linking to
    // its full-resolution image) should still zoom rather than follow the link
    // (#4757). Footnotes are excluded so footnote links keep their
    // popup/navigation behavior.
    const media = !isFixedLayout && !footnote ? detectMediaTarget(element) : null;
    if (
      !media &&
      element?.closest('sup, a, audio, video') &&
      !element?.closest('a.duokan-footnote:not([href])')
    ) {
      return;
    }
    if (footnote) {
      eventDispatcher.dispatch('footnote-popup', {
        bookKey,
        element: footnote,
        footnote:
          footnote.getAttribute('data-wr-footernote') ||
          footnote.getAttribute('zy-footnote') ||
          footnote.querySelector('img')?.getAttribute('alt') ||
          footnote.getAttribute('alt') ||
          element?.getAttribute('alt') ||
          '',
      });
      return;
    }

    // if the mouse button is still held, a drag is in progress (e.g. a
    // double-click-and-drag selection); sending a single click here would turn
    // the page mid-selection (#4524).
    if (isMouseDown) {
      return;
    }

    // if long hold is detected, we don't want to send single click event
    if (!longHoldTimeout) {
      return;
    }

    // Word Lens: tapping a glossed word looks it up in the dictionary. Checked
    // after the drag/long-hold guards so only a clean single tap triggers it.
    const glossWord = findGlossWord(element);
    if (glossWord) {
      const ruby = element?.closest('ruby.wl-gloss') ?? null;
      eventDispatcher.dispatch('wordlens-dictionary', { bookKey, element: ruby, word: glossWord });
      return;
    }

    // In reflowable books a single tap on an image/table opens the image gallery
    // / table zoom (#4584) — it is the only gesture that does, since long-press
    // fired mid-scroll and was removed (#5069). Fixed-layout books
    // (PDF/comics/manga) keep tap-to-turn, since there the tap is the page-turn
    // gesture (media is null there).
    if (media) {
      window.postMessage({ type: 'iframe-open-media', bookKey, ...media }, '*');
      return;
    }

    window.postMessage(
      {
        type: 'iframe-single-click',
        bookKey,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: event.offsetX,
        offsetY: event.offsetY,
        ...getKeyStatus(event),
      },
      '*',
    );
  };
  if (!doubleClickDisabled.current) {
    setTimeout(() => {
      if (Date.now() - lastClickTime >= DOUBLE_CLICK_INTERVAL_THRESHOLD_MS) {
        postSingleClick();
      }
    }, DOUBLE_CLICK_INTERVAL_THRESHOLD_MS);
  } else {
    // Mouse clicks remain synchronous. A touch-synthesized click waits one
    // task so the parent realm can publish a native captured-turn claim.
    if (layeredTurnTouchClaims.get(bookKey)?.ended) setTimeout(postSingleClick, 0);
    else postSingleClick();
  }
};

const createTouchDetail = (
  phase: TouchDetail['phase'],
  touch: SerializedTouch,
  touchStart: SerializedTouch,
  startTime: number,
  endTime: number,
): TouchDetail => ({
  phase,
  touch: { screenX: touch.screenX, screenY: touch.screenY },
  touchStart: { screenX: touchStart.screenX, screenY: touchStart.screenY },
  deltaX: touch.screenX - touchStart.screenX,
  deltaY: touch.screenY - touchStart.screenY,
  deltaT: endTime - startTime,
});

const handleTouchEv = (bookKey: string, event: TouchEvent, type: string) => {
  // Use event.touches (all active touches) instead of event.targetTouches
  // so that multi-finger gestures work even when fingers land on different
  // elements within the iframe (e.g. canvas vs textLayer spans in PDF)
  const serializeTouches = (touchList: TouchList) => {
    const touches = [];
    for (let i = 0; i < touchList.length; i++) {
      const touch = touchList[i];
      if (touch) {
        touches.push({
          clientX: touch.clientX,
          clientY: touch.clientY,
          screenX: touch.screenX,
          screenY: touch.screenY,
        });
      }
    }
    return touches;
  };
  const targetTouches = serializeTouches(event.touches);
  const changedTouches = serializeTouches(event.changedTouches);
  let rawInterceptorsDispatched: boolean | undefined;
  let rawInterceptorConsumed = false;
  if (type === 'iframe-touchstart') {
    beginLayeredTurnTouch(bookKey);
    const rawAxes = getRawFixedLayoutPanAxes(event);
    if (rawAxes !== undefined) {
      if (rawAxes) touchPanArmedBooks.set(bookKey, rawAxes);
      else touchPanArmedBooks.delete(bookKey);
    }
    const touch = targetTouches[0];
    if (touch) {
      const isSingleTouch = event.touches.length === 1;
      const previousGesture = touchGestures.get(bookKey);
      const interceptorConsumed = isSingleTouch
        ? dispatchTouchInterceptors(
            bookKey,
            createTouchDetail('start', touch, touch, event.timeStamp, event.timeStamp),
          )
        : (previousGesture?.interceptorConsumed ?? false);
      rawInterceptorsDispatched = true;
      rawInterceptorConsumed = interceptorConsumed;
      const nativeTurn = isSingleTouch ? createNativeTurnIntent(event, touch) : null;
      touchGestures.set(bookKey, {
        startX: touch.screenX,
        startY: touch.screenY,
        startTime: event.timeStamp,
        moved: false,
        touchPanClaimed: false,
        interceptorConsumed,
        turnHost: nativeTurn?.host,
        turnIntent: nativeTurn?.intent,
      });
    }
  } else if (type === 'iframe-touchmove') {
    const gesture = touchGestures.get(bookKey);
    const touch = targetTouches[0];
    if (gesture && touch) {
      const distance = Math.hypot(touch.screenX - gesture.startX, touch.screenY - gesture.startY);
      if (distance >= SYNTHESIZED_CLICK_SWIPE_DISTANCE_PX) gesture.moved = true;
      if (event.touches.length === 1) {
        gesture.interceptorConsumed ||= dispatchTouchInterceptors(
          bookKey,
          createTouchDetail(
            'move',
            touch,
            {
              clientX: gesture.startX,
              clientY: gesture.startY,
              screenX: gesture.startX,
              screenY: gesture.startY,
            },
            gesture.startTime,
            event.timeStamp,
          ),
        );
      }
      rawInterceptorsDispatched = true;
      rawInterceptorConsumed = gesture.interceptorConsumed;
      if (gesture.interceptorConsumed || gesture.touchPanClaimed) {
        event.preventDefault();
      } else {
        const rawAxes = getRawFixedLayoutPanAxes(event);
        const panAxes = rawAxes === undefined ? touchPanArmedBooks.get(bookKey) : rawAxes;
        const horizontalDominant =
          Math.abs(touch.screenX - gesture.startX) >= Math.abs(touch.screenY - gesture.startY);
        const canClaimPan =
          !!panAxes &&
          (horizontalDominant ? panAxes.horizontal : panAxes.vertical) &&
          event.touches.length === 1 &&
          distance >= RAW_TOUCH_PAN_THRESHOLD_PX;
        if (canClaimPan) {
          gesture.touchPanClaimed = true;
          event.preventDefault();
        }
      }
      const { turnHost, turnIntent } = gesture;
      if (!gesture.interceptorConsumed && !gesture.touchPanClaimed && turnHost && turnIntent) {
        const currentTarget = event.currentTarget as Document | null;
        const selection = currentTarget?.getSelection?.();
        const invalid =
          event.touches.length !== 1 ||
          !turnHost.hasAttribute(NATIVE_CAPTURED_TURN_ATTRIBUTE) ||
          turnHost.hasAttribute(NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE) ||
          !!turnHost.scrollLocked ||
          !!(selection && !selection.isCollapsed);
        if (invalid) {
          gesture.turnHost = undefined;
          gesture.turnIntent = undefined;
        } else if (
          shouldClaimTurnGesture(
            turnIntent,
            {
              deltaX: touch.screenX - gesture.startX,
              deltaY: touch.screenY - gesture.startY,
              deltaT: event.timeStamp - gesture.startTime,
            },
            SYNTHESIZED_CLICK_SWIPE_DISTANCE_PX,
          )
        ) {
          gesture.turnIntent = undefined;
          setLayeredTurnTouchClaimed(bookKey, true);
          // Native capture recognition reaches the React interceptor through
          // postMessage. Claim the browser gesture synchronously here as well,
          // so a 1–6px page turn cannot generate a compatibility/link click in
          // the gap before that message is handled.
          event.preventDefault();
        }
      }
    }
  } else if (type === 'iframe-touchend' || type === 'iframe-touchcancel') {
    const gesture = touchGestures.get(bookKey);
    // Very fast flicks can go from touchstart straight to touchend without a
    // touchmove event. Include the released finger when deciding whether the
    // browser-generated click belongs to a swipe.
    const releasedTouch = changedTouches[0];
    let interceptorConsumed = gesture?.interceptorConsumed ?? false;
    if (gesture && event.touches.length === 0) {
      const touch =
        releasedTouch ??
        targetTouches[0] ??
        ({
          clientX: gesture.startX,
          clientY: gesture.startY,
          screenX: gesture.startX,
          screenY: gesture.startY,
        } satisfies SerializedTouch);
      const detail = createTouchDetail(
        type === 'iframe-touchend' ? 'end' : 'cancel',
        touch,
        {
          clientX: gesture.startX,
          clientY: gesture.startY,
          screenX: gesture.startX,
          screenY: gesture.startY,
        },
        gesture.startTime,
        event.timeStamp,
      );
      interceptorConsumed ||= dispatchTouchInterceptors(bookKey, detail);
      gesture.interceptorConsumed = interceptorConsumed;
      rawInterceptorsDispatched = true;
      rawInterceptorConsumed = interceptorConsumed;
    }
    const layeredClaim = layeredTurnTouchClaims.get(bookKey);
    if (
      (type === 'iframe-touchend' || type === 'iframe-touchcancel') &&
      (layeredClaim?.claimed || gesture?.touchPanClaimed || interceptorConsumed)
    ) {
      event.preventDefault();
    }
    const moved =
      layeredClaim?.claimed ||
      gesture?.touchPanClaimed ||
      gesture?.moved ||
      interceptorConsumed ||
      (gesture &&
        releasedTouch &&
        Math.hypot(
          releasedTouch.screenX - gesture.startX,
          releasedTouch.screenY - gesture.startY,
        ) >= SYNTHESIZED_CLICK_SWIPE_DISTANCE_PX);
    if (type === 'iframe-touchend' && moved && gesture) {
      suppressedSwipeClicks.set(bookKey, {
        until: Date.now() + SYNTHESIZED_CLICK_SUPPRESSION_MS,
        endX: releasedTouch?.screenX ?? gesture.startX,
        endY: releasedTouch?.screenY ?? gesture.startY,
      });
    }
    touchGestures.delete(bookKey);
    if (type === 'iframe-touchcancel') {
      cancelLayeredTurnTouch(bookKey);
    } else {
      endLayeredTurnTouch(bookKey);
    }
  }
  window.postMessage(
    {
      type: type,
      bookKey,
      timeStamp: Date.now(),
      targetTouches,
      changedTouches,
      ...(rawInterceptorsDispatched
        ? { interceptorsDispatched: true, interceptorConsumed: rawInterceptorConsumed }
        : null),
      ...getKeyStatus(event),
    },
    '*',
  );
};

export const handleTouchStart = (bookKey: string, event: TouchEvent) => {
  handleTouchEv(bookKey, event, 'iframe-touchstart');
};

export const handleTouchMove = (bookKey: string, event: TouchEvent) => {
  handleTouchEv(bookKey, event, 'iframe-touchmove');
};

export const handleTouchEnd = (bookKey: string, event: TouchEvent) => {
  handleTouchEv(bookKey, event, 'iframe-touchend');
};

export const handleTouchCancel = (bookKey: string, event: TouchEvent) => {
  handleTouchEv(bookKey, event, 'iframe-touchcancel');
};
