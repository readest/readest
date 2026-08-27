import { useEffect, useState } from 'react';
import { loadShortcuts, ShortcutConfig } from '../helpers/shortcuts';
import { matchesShortcut, ShortcutEventLike } from '../utils/shortcutKeys';
import { eventDispatcher } from '@/utils/event';

export type KeyActionHandlers = {
  [K in keyof ShortcutConfig]?: (
    event?: KeyboardEvent | MessageEvent,
  ) => void | boolean | Promise<void | boolean>;
};

const NOTE_EDITOR_ACTIONS = new Set<keyof ShortcutConfig>(['onSaveNote', 'onEscape']);

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return !!element?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName ?? '');
};

const isNativeActivation = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement | null;
  return /^(A|BUTTON)$/.test(target?.tagName ?? '') && (event.key === 'Enter' || event.key === ' ');
};

const useShortcuts = (
  actions: KeyActionHandlers,
  dependencies: React.DependencyList = [],
  options: {
    allowInInputs?: boolean;
    capture?: boolean;
    requireModifierInInputs?: boolean;
  } = {},
) => {
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(loadShortcuts);

  useEffect(() => {
    const handleShortcutUpdate = () => {
      setShortcuts(loadShortcuts());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'customShortcuts') handleShortcutUpdate();
    };

    window.addEventListener('shortcutUpdate', handleShortcutUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('shortcutUpdate', handleShortcutUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const processKeyEvent = (
    eventLike: ShortcutEventLike,
    event: KeyboardEvent | MessageEvent,
    allowedActions?: ReadonlySet<keyof ShortcutConfig>,
  ) => {
    for (const [actionName, actionHandler] of Object.entries(actions)) {
      const shortcutKey = actionName as keyof ShortcutConfig;
      if (allowedActions && !allowedActions.has(shortcutKey)) continue;
      const handler = actionHandler as KeyActionHandlers[keyof ShortcutConfig];
      const shortcutEntry = shortcuts[shortcutKey as keyof ShortcutConfig];
      // console.log('Checking action:', shortcutKey);
      if (handler && shortcutEntry?.keys && matchesShortcut(eventLike, shortcutEntry.keys)) {
        const result = handler(event);
        if (result !== false) return true;
      }
    }
    // Keep Backspace from navigating away when no action claims it.
    return eventLike.key.toLowerCase() === 'backspace';
  };

  const unifiedHandleKeyDown = (event: KeyboardEvent | MessageEvent) => {
    if (document.querySelector('[data-shortcut-recording="true"]')) return;

    // Check if the focus is on an input, textarea, or contenteditable element
    const activeElement = document.activeElement as HTMLElement | null;
    const isInteractiveElement = isInteractiveTarget(activeElement);
    const iframeInteractiveTarget =
      event instanceof MessageEvent &&
      event.data?.type === 'iframe-keydown' &&
      !!event.data.interactiveTarget;
    const isInteractiveInput = isInteractiveElement || iframeInteractiveTarget;

    const isNoteEditor =
      activeElement?.tagName === 'TEXTAREA' && activeElement.classList.contains('note-editor');

    if (isInteractiveInput && !isNoteEditor && !options.allowInInputs) {
      return; // Skip handling if the user is typing in an input, textarea, or contenteditable
    }
    const hasCommandModifier =
      event instanceof KeyboardEvent
        ? event.ctrlKey || event.altKey || event.metaKey
        : !!(event.data?.ctrlKey || event.data?.altKey || event.data?.metaKey);
    if (isInteractiveInput && options.requireModifierInInputs && !hasCommandModifier) return;

    if (event instanceof KeyboardEvent) {
      const { key, ctrlKey, altKey, metaKey, shiftKey } = event;

      if (isNativeActivation(event) && !options.allowInInputs) return;

      if (ctrlKey && key.toLowerCase() === 'f') {
        event.preventDefault();
      }

      const handled = processKeyEvent(
        {
          key,
          ctrlKey,
          altKey,
          metaKey,
          shiftKey,
          altGraphKey: event.getModifierState('AltGraph'),
        },
        event,
        isNoteEditor ? NOTE_EDITOR_ACTIONS : undefined,
      );
      // console.log('Key event handled:', key, handled);
      if (handled) event.preventDefault();
    } else if (
      event instanceof MessageEvent &&
      event.data &&
      event.data.type === 'iframe-keydown'
    ) {
      if (event.data.handled) return;
      const { key, ctrlKey, altKey, metaKey, shiftKey, altGraphKey } = event.data;
      processKeyEvent({ key, ctrlKey, altKey, metaKey, shiftKey, altGraphKey }, event);
    }
  };

  const getMouseEventLike = (event: MouseEvent): ShortcutEventLike | null => {
    const key = event.button === 3 ? 'MouseX1' : event.button === 4 ? 'MouseX2' : null;
    if (!key) return null;
    return {
      key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
  };

  const hasMouseShortcut = (eventLike: ShortcutEventLike) =>
    Object.entries(actions).some(([actionName, handler]) => {
      const entry = shortcuts[actionName as keyof ShortcutConfig];
      return !!handler && !!entry && matchesShortcut(eventLike, entry.keys);
    });

  const handleMouseEvent = (event: MouseEvent) => {
    const eventLike = getMouseEventLike(event);
    if (!eventLike || !hasMouseShortcut(eventLike)) return;
    event.preventDefault();
    if (event.type !== 'mouseup') return;
    const message = new MessageEvent('shortcut-mouseup', {
      data: { type: 'shortcut-mouseup', button: event.button },
    });
    if (processKeyEvent(eventLike, message)) event.stopImmediatePropagation();
  };

  const handleIframeMouseUp = (customEvent: CustomEvent) => {
    const detail = customEvent.detail as { bookKey?: string; event?: MouseEvent } | undefined;
    if (!detail?.event) return false;
    const eventLike = getMouseEventLike(detail.event);
    if (!eventLike || !hasMouseShortcut(eventLike)) return false;
    const message = new MessageEvent('iframe-mouseup', {
      data: {
        type: 'iframe-mouseup',
        bookKey: detail.bookKey,
        button: detail.event.button,
      },
    });
    return processKeyEvent(eventLike, message);
  };

  const handleIframeKeyDown = (customEvent: CustomEvent) => {
    const detail = customEvent.detail as { bookKey?: string; event?: KeyboardEvent } | undefined;
    if (!detail?.event) return false;
    if (
      (isInteractiveTarget(detail.event.target) || isNativeActivation(detail.event)) &&
      !options.allowInInputs
    ) {
      return false;
    }
    const { key, code, ctrlKey, altKey, metaKey, shiftKey, repeat } = detail.event;
    const eventLike: ShortcutEventLike = {
      key,
      ctrlKey,
      altKey,
      metaKey,
      shiftKey,
      altGraphKey: detail.event.getModifierState('AltGraph'),
    };
    const message = new MessageEvent('iframe-keydown', {
      data: {
        type: 'iframe-keydown',
        bookKey: detail.bookKey,
        key,
        code,
        ctrlKey,
        altKey,
        metaKey,
        shiftKey,
        altGraphKey: eventLike.altGraphKey,
        repeat,
      },
    });
    return processKeyEvent(eventLike, message);
  };

  useEffect(() => {
    window.addEventListener('keydown', unifiedHandleKeyDown, options.capture);
    window.addEventListener('message', unifiedHandleKeyDown);
    window.addEventListener('mousedown', handleMouseEvent);
    window.addEventListener('mouseup', handleMouseEvent);
    window.addEventListener('auxclick', handleMouseEvent);
    eventDispatcher.onSync('iframe-shortcut-mouseup', handleIframeMouseUp);
    eventDispatcher.onSync('iframe-shortcut-keydown', handleIframeKeyDown);

    return () => {
      window.removeEventListener('keydown', unifiedHandleKeyDown, options.capture);
      window.removeEventListener('message', unifiedHandleKeyDown);
      window.removeEventListener('mousedown', handleMouseEvent);
      window.removeEventListener('mouseup', handleMouseEvent);
      window.removeEventListener('auxclick', handleMouseEvent);
      eventDispatcher.offSync('iframe-shortcut-mouseup', handleIframeMouseUp);
      eventDispatcher.offSync('iframe-shortcut-keydown', handleIframeKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts, options.allowInInputs, options.capture, ...dependencies]);
};

export default useShortcuts;
