import { DOUBLE_CLICK_INTERVAL_THRESHOLD_MS, LONG_HOLD_THRESHOLD } from '@/services/constants';
import { eventDispatcher } from '@/utils/event';

let lastClickTime = 0;
let longHoldTimeout: ReturnType<typeof setTimeout> | null = null;

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
  longHoldTimeout = setTimeout(() => {
    longHoldTimeout = null;
  }, LONG_HOLD_THRESHOLD);

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
      ...getKeyStatus(event),
    },
    '*',
  );
};

export const handleMouseup = (bookKey: string, event: MouseEvent) => {
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

export const handleClick = (
  bookKey: string,
  doubleClickDisabled: React.MutableRefObject<boolean>,
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
    if (
      element?.closest('sup, a, audio, video') &&
      !element?.closest('a.duokan-footnote:not([href])')
    ) {
      return;
    }
    const footnote = element?.closest('.js_readerFooterNote, .zhangyue-footnote, .duokan-footnote');
    if (footnote) {
      eventDispatcher.dispatch('footnote-popup', {
        bookKey,
        element: footnote,
        footnote:
          footnote.getAttribute('data-wr-footernote') ||
          footnote.getAttribute('zy-footnote') ||
          footnote.getAttribute('alt') ||
          element?.getAttribute('alt') ||
          '',
      });
      return;
    }

    // if long hold is detected, we don't want to send single click event
    if (!longHoldTimeout) {
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
  const touch = event.targetTouches[0];
  const touches = [];
  if (touch) {
    touches.push({
      clientX: touch.clientX,
      clientY: touch.clientY,
      screenX: touch.screenX,
      screenY: touch.screenY,
    });
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

    if (target.localName === 'img') {
      const imgTarget = target as HTMLImageElement;
      window.postMessage(
        {
          type: 'iframe-long-press',
          bookKey,
          elementType: 'image',
          src: imgTarget.src,
        },
        '*',
      );
    } else if (target.localName === 'table' || target.closest('table')) {
      const tableTarget = (
        target.localName === 'table' ? target : target.closest('table')
      ) as HTMLTableElement;
      window.postMessage(
        {
          type: 'iframe-long-press',
          bookKey,
          elementType: 'table',
          html: tableTarget.outerHTML,
        },
        '*',
      );
    }
  };

  const startPress = (event: Event) => {
    const target = event.target as HTMLElement;
    const isImage = target.localName === 'img';
    const isTableOrInTable = target.localName === 'table' || target.closest('table');

    if (!isImage && !isTableOrInTable) return;

    const elementToTrack = isImage
      ? target
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
    const isTableOrInTable = target.localName === 'table' || target.closest('table');

    if (!isImage && !isTableOrInTable) return;

    const elementToTrack = isImage
      ? target
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
    const isTableOrInTable = target.localName === 'table' || target.closest('table');

    if (!isImage && !isTableOrInTable) return;

    const elementToTrack = isImage
      ? target
      : ((target.localName === 'table' ? target : target.closest('table')) as HTMLElement);

    clearTimeout(pressTimers.get(elementToTrack));
    pressTimers.delete(elementToTrack);
    pressStartPositions.delete(elementToTrack);
  };

  const processElements = () => {
    const images = doc.querySelectorAll('img');
    const tables = doc.querySelectorAll('table');

    images.forEach((img) => {
      if (!img.hasAttribute('data-long-press-added')) {
        img.setAttribute('data-long-press-added', 'true');
        img.addEventListener('mousedown', startPress);
        img.addEventListener('mousemove', handleMove);
        img.addEventListener('mouseup', cancelPress);
        img.addEventListener('mouseleave', cancelPress);
        img.addEventListener('touchstart', startPress, { passive: true });
        img.addEventListener('touchmove', handleMove, { passive: true });
        img.addEventListener('touchend', cancelPress);
      }
    });

    tables.forEach((table) => {
      if (!table.hasAttribute('data-long-press-added')) {
        table.setAttribute('data-long-press-added', 'true');
        table.addEventListener('mousedown', startPress);
        table.addEventListener('mousemove', handleMove);
        table.addEventListener('mouseup', cancelPress);
        table.addEventListener('mouseleave', cancelPress);
        table.addEventListener('touchstart', startPress, { passive: true });
        table.addEventListener('touchmove', handleMove, { passive: true });
        table.addEventListener('touchend', cancelPress);
      }
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
