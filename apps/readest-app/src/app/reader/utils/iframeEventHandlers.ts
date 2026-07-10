import { DOUBLE_CLICK_INTERVAL_THRESHOLD_MS, LONG_HOLD_THRESHOLD } from '@/services/constants';
import { eventDispatcher } from '@/utils/event';
import { findGlossWord } from '@/app/reader/utils/wordlensRuby';

let lastClickTime = 0;
let longHoldTimeout: ReturnType<typeof setTimeout> | null = null;
let isMouseDown = false;

// Middle-click autoscroll (#4951). Books where the feature is armed (desktop
// app, scrolled mode, setting on) get the middle button's defaults suppressed,
// so the WebView's own autoscroll (WebView2) can't scroll alongside ours and a
// middle-clicked link doesn't open. These handlers run in the main realm, so
// the hook toggles this state directly.
const autoscrollArmedBooks = new Set<string>();
// Whether an autoscroll session is running; gates mousemove forwarding so the
// stream costs nothing while idle.
let autoscrollTracking = false;

export const setAutoscrollArmed = (bookKey: string, armed: boolean) => {
  if (armed) autoscrollArmedBooks.add(bookKey);
  else autoscrollArmedBooks.delete(bookKey);
};

export const setAutoscrollTracking = (tracking: boolean) => {
  autoscrollTracking = tracking;
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
    },
    '*',
  );
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
  longHoldTimeout = setTimeout(() => {
    longHoldTimeout = null;
  }, LONG_HOLD_THRESHOLD);

  if (event.button === 1 && autoscrollArmedBooks.has(bookKey)) {
    event.preventDefault();
  }

  window.postMessage(
    {
      type: 'iframe-mousedown',
      bookKey,
      button: event.button,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: event.offsetX,
      offsetY: event.offsetY,
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
};

export const handleMousemove = (bookKey: string, event: MouseEvent) => {
  if (!autoscrollTracking) return;
  window.postMessage(
    {
      type: 'iframe-mousemove',
      bookKey,
      screenX: event.screenX,
      screenY: event.screenY,
    },
    '*',
  );
};

export const handleMouseup = (bookKey: string, event: MouseEvent) => {
  isMouseDown = false;
  // we will handle mouse back and forward buttons ourselves
  if ([3, 4].includes(event.button)) {
    event.preventDefault();
  }
  window.postMessage(
    {
      type: 'iframe-mouseup',
      bookKey,
      button: event.button,
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

// A tappable/long-pressable media element under the pointer, resolved to the
// payload the image gallery / table zoom viewers consume. Shared by the
// long-press path and the single-tap path so the two can't drift.
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
  event: MouseEvent,
) => {
  const now = Date.now();

  if (!doubleClickDisabled.current && now - lastClickTime < DOUBLE_CLICK_INTERVAL_THRESHOLD_MS) {
    lastClickTime = now;
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
    // its full-resolution image) should still zoom rather than follow the link,
    // matching long-press (#4757). Footnotes are excluded so footnote links keep
    // their popup/navigation behavior.
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

    // In reflowable books a single tap on an image/table opens the same viewer
    // a long-press does, so the image gallery / table zoom is reachable by both
    // gestures (#4584). Fixed-layout books (PDF/comics/manga) keep tap-to-turn,
    // since there the tap is the page-turn gesture (media is null there).
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
    postSingleClick();
  }
};

const handleTouchEv = (bookKey: string, event: TouchEvent, type: string) => {
  // Use event.touches (all active touches) instead of event.targetTouches
  // so that multi-finger gestures work even when fingers land on different
  // elements within the iframe (e.g. canvas vs textLayer spans in PDF)
  const touchList = type === 'iframe-touchend' ? event.targetTouches : event.touches;
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
  window.postMessage(
    {
      type: type,
      bookKey,
      timeStamp: Date.now(),
      targetTouches: touches,
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

export const addLongPressListeners = (bookKey: string, doc: Document) => {
  const longPressDuration = 500;
  const moveThreshold = 10; // pixels - movement threshold to detect dragging/selection
  const pressTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  const pressStartPositions = new Map<Element, { x: number; y: number }>();

  const handleLongPress = (event: Event, target: HTMLElement) => {
    event.preventDefault?.();

    // Check if there's an active text selection - if so, don't trigger long-press
    const selection = doc.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    const media = detectMediaTarget(target);
    if (media) {
      window.postMessage({ type: 'iframe-open-media', bookKey, ...media }, '*');
    }
  };

  const startPress = (event: Event) => {
    const target = event.target as HTMLElement;
    const isImage = target.localName === 'img';
    const isSvgImage = !isImage && !!target.closest('svg')?.querySelector('image');
    const isTableOrInTable = target.localName === 'table' || target.closest('table');

    if (!isImage && !isSvgImage && !isTableOrInTable) return;

    const elementToTrack = isImage
      ? target
      : isSvgImage
        ? (target.closest('svg') as unknown as HTMLElement)
        : ((target.localName === 'table' ? target : target.closest('table')) as HTMLElement);

    // Store initial position for movement detection
    if ('clientX' in event && 'clientY' in event) {
      const mouseEvent = event as MouseEvent;
      pressStartPositions.set(elementToTrack, { x: mouseEvent.clientX, y: mouseEvent.clientY });
    } else if ('touches' in event) {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.touches[0];
      if (touch) {
        pressStartPositions.set(elementToTrack, { x: touch.clientX, y: touch.clientY });
      }
    }

    clearTimeout(pressTimers.get(elementToTrack));
    const timer = setTimeout(() => handleLongPress(event, elementToTrack), longPressDuration);
    pressTimers.set(elementToTrack, timer);
  };

  const handleMove = (event: Event) => {
    const target = event.target as HTMLElement;
    const isImage = target.localName === 'img';
    const isSvgImage = !isImage && !!target.closest('svg')?.querySelector('image');
    const isTableOrInTable = target.localName === 'table' || target.closest('table');

    if (!isImage && !isSvgImage && !isTableOrInTable) return;

    const elementToTrack = isImage
      ? target
      : isSvgImage
        ? (target.closest('svg') as unknown as HTMLElement)
        : ((target.localName === 'table' ? target : target.closest('table')) as HTMLElement);

    // Check if mouse/touch moved beyond threshold - if so, user is probably selecting text or dragging
    const startPos = pressStartPositions.get(elementToTrack);
    if (startPos) {
      let currentX = 0;
      let currentY = 0;

      if ('clientX' in event && 'clientY' in event) {
        const mouseEvent = event as MouseEvent;
        currentX = mouseEvent.clientX;
        currentY = mouseEvent.clientY;
      } else if ('touches' in event) {
        const touchEvent = event as TouchEvent;
        const touch = touchEvent.touches[0];
        if (touch) {
          currentX = touch.clientX;
          currentY = touch.clientY;
        }
      }

      const distance = Math.sqrt(
        Math.pow(currentX - startPos.x, 2) + Math.pow(currentY - startPos.y, 2),
      );

      // If moved beyond threshold, cancel the long-press
      if (distance > moveThreshold) {
        clearTimeout(pressTimers.get(elementToTrack));
        pressTimers.delete(elementToTrack);
        pressStartPositions.delete(elementToTrack);
      }
    }
  };

  const cancelPress = (event: Event) => {
    const target = event.target as HTMLElement;
    const isImage = target.localName === 'img';
    const isSvgImage = !isImage && !!target.closest('svg')?.querySelector('image');
    const isTableOrInTable = target.localName === 'table' || target.closest('table');

    if (!isImage && !isSvgImage && !isTableOrInTable) return;

    const elementToTrack = isImage
      ? target
      : isSvgImage
        ? (target.closest('svg') as unknown as HTMLElement)
        : ((target.localName === 'table' ? target : target.closest('table')) as HTMLElement);

    clearTimeout(pressTimers.get(elementToTrack));
    pressTimers.delete(elementToTrack);
    pressStartPositions.delete(elementToTrack);
  };

  const processElements = () => {
    const addLongPressListeners = (el: Element) => {
      if (el.hasAttribute('data-long-press-added')) return;
      el.setAttribute('data-long-press-added', 'true');
      el.addEventListener('mousedown', startPress);
      el.addEventListener('mousemove', handleMove);
      el.addEventListener('mouseup', cancelPress);
      el.addEventListener('mouseleave', cancelPress);
      el.addEventListener('touchstart', startPress, { passive: true });
      el.addEventListener('touchmove', handleMove, { passive: true });
      el.addEventListener('touchend', cancelPress);
    };

    doc.querySelectorAll('img, table').forEach(addLongPressListeners);
    doc.querySelectorAll('svg').forEach((svg) => {
      if (svg.querySelector('image')) addLongPressListeners(svg);
    });
  };

  processElements();

  const observer = new MutationObserver((mutations) => {
    const hasNewElements = mutations.some((m) => m.type === 'childList' && m.addedNodes.length > 0);
    if (hasNewElements) {
      processElements();
    }
  });

  observer.observe(doc.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    pressTimers.forEach((timer) => clearTimeout(timer));
  };
};
