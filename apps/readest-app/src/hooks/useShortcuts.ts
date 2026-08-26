import { useEffect, useState } from 'react';
import { loadShortcuts, ShortcutConfig } from '../helpers/shortcuts';
import { matchesShortcut, ShortcutEventLike } from '../utils/shortcutKeys';
import { eventDispatcher } from '@/utils/event';

export type KeyActionHandlers = {
  [K in keyof ShortcutConfig]?: (
    event?: KeyboardEvent | MessageEvent,
  ) => void | boolean | Promise<void | boolean>;
};

const useShortcuts = (
  actions: KeyActionHandlers,
  dependencies: React.DependencyList = [],
  options: { allowInInputs?: boolean } = {},
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
    consumeOnMatch = false,
  ) => {
    // FIXME: This is a temporary fix to disable Back button navigation
    if (eventLike.key.toLowerCase() === 'backspace') return true;
    for (const [actionName, actionHandler] of Object.entries(actions)) {
      const shortcutKey = actionName as keyof ShortcutConfig;
      const handler = actionHandler as KeyActionHandlers[keyof ShortcutConfig];
      const shortcutEntry = shortcuts[shortcutKey as keyof ShortcutConfig];
      // console.log('Checking action:', shortcutKey);
      if (handler && shortcutEntry?.keys && matchesShortcut(eventLike, shortcutEntry.keys)) {
        const result = handler(event);
        if (result || (consumeOnMatch && result !== false)) {
          return true;
        }
      }
    }
    return false;
  };

  const unifiedHandleKeyDown = (event: KeyboardEvent | MessageEvent) => {
    // Check if the focus is on an input, textarea, or contenteditable element
    const activeElement = document.activeElement as HTMLElement;
    const isInteractiveElement =
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable;

    const isNoteEditor =
      activeElement.tagName === 'TEXTAREA' && activeElement.classList.contains('note-editor');

    if (isInteractiveElement && !isNoteEditor && !options.allowInInputs) {
      return; // Skip handling if the user is typing in an input, textarea, or contenteditable
    }

    if (event instanceof KeyboardEvent) {
      const { key, ctrlKey, altKey, metaKey, shiftKey } = event;

      if (isNoteEditor && !((key === 'Enter' && ctrlKey) || key == 'Escape')) {
        return;
      }

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
      );
      // console.log('Key event handled:', key, handled);
      if (handled) event.preventDefault();
    } else if (
      event instanceof MessageEvent &&
      event.data &&
      event.data.type === 'iframe-keydown'
    ) {
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
    if (processKeyEvent(eventLike, message, true)) event.stopImmediatePropagation();
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
    return processKeyEvent(eventLike, message, true);
  };

  useEffect(() => {
    window.addEventListener('keydown', unifiedHandleKeyDown);
    window.addEventListener('message', unifiedHandleKeyDown);
    window.addEventListener('mousedown', handleMouseEvent);
    window.addEventListener('mouseup', handleMouseEvent);
    window.addEventListener('auxclick', handleMouseEvent);
    eventDispatcher.onSync('iframe-shortcut-mouseup', handleIframeMouseUp);

    return () => {
      window.removeEventListener('keydown', unifiedHandleKeyDown);
      window.removeEventListener('message', unifiedHandleKeyDown);
      window.removeEventListener('mousedown', handleMouseEvent);
      window.removeEventListener('mouseup', handleMouseEvent);
      window.removeEventListener('auxclick', handleMouseEvent);
      eventDispatcher.offSync('iframe-shortcut-mouseup', handleIframeMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts, options.allowInInputs, ...dependencies]);
};

export default useShortcuts;
