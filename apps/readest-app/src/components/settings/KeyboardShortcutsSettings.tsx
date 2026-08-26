import React, { useEffect, useRef, useState } from 'react';
import Alert from '@/components/Alert';
import ModalPortal from '@/components/ModalPortal';
import {
  getDefaultShortcuts,
  getShortcutConflicts,
  loadShortcuts,
  resetShortcutBinding,
  saveShortcuts,
  setShortcutBinding,
  SHORTCUT_SECTIONS,
  ShortcutAction,
  ShortcutConfig,
} from '@/helpers/shortcuts';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { isMacPlatform } from '@/services/environment';
import {
  filterPlatformKeys,
  formatKeyForDisplay,
  getShortcutFromKeyboardEvent,
  getShortcutFromMouseEvent,
} from '@/utils/shortcutKeys';
import SubPageHeader from './SubPageHeader';
import { BoxedList, SettingsRow } from './primitives';

const LEARN_TIMEOUT_MS = 8000;

type PendingReplacement = {
  action: ShortcutAction;
  binding: string;
  conflicts: ShortcutAction[];
};

interface KeyboardShortcutsSettingsProps {
  onBack: () => void;
}

const KeyboardShortcutsSettings: React.FC<KeyboardShortcutsSettingsProps> = ({ onBack }) => {
  const _ = useTranslation();
  const isMac = isMacPlatform();
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(loadShortcuts);
  const shortcutsRef = useRef(shortcuts);
  const [listening, setListening] = useState<ShortcutAction | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<PendingReplacement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useKeyDownActions({ onCancel: onBack, enabled: !listening && !pendingReplacement });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let parent = rootRef.current?.parentElement;
      while (parent && parent.tagName !== 'DIALOG') {
        if (parent.scrollHeight > parent.clientHeight) {
          parent.scrollTo({ top: 0 });
          break;
        }
        parent = parent.parentElement;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const persist = (next: ShortcutConfig) => {
    shortcutsRef.current = next;
    setShortcuts(next);
    saveShortcuts(next);
  };

  const stopListening = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setListening(null);
  };

  const finishCapture = (binding: string) => {
    if (!listening) return;
    const action = listening;
    const conflicts = getShortcutConflicts(shortcutsRef.current, action, binding);
    stopListening();
    if (conflicts.length > 0) {
      setPendingReplacement({ action, binding, conflicts });
      return;
    }
    persist(setShortcutBinding(shortcutsRef.current, action, binding));
  };

  useEffect(() => {
    if (!listening) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        stopListening();
        return;
      }
      const binding = getShortcutFromKeyboardEvent(event);
      if (binding) finishCapture(binding);
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (!getShortcutFromMouseEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handleMouseUp = (event: MouseEvent) => {
      const binding = getShortcutFromMouseEvent(event);
      if (!binding) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const button = event.button;
      const suppressAuxClick = (auxEvent: MouseEvent) => {
        if (auxEvent.button !== button) return;
        auxEvent.preventDefault();
        auxEvent.stopImmediatePropagation();
        window.removeEventListener('auxclick', suppressAuxClick, true);
      };
      window.addEventListener('auxclick', suppressAuxClick, true);
      setTimeout(() => window.removeEventListener('auxclick', suppressAuxClick, true), 250);
      finishCapture(binding);
    };
    const handleAuxClick = (event: MouseEvent) => {
      if (!getShortcutFromMouseEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('auxclick', handleAuxClick, true);
    timeoutRef.current = setTimeout(stopListening, LEARN_TIMEOUT_MS);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('auxclick', handleAuxClick, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  const defaults = getDefaultShortcuts();
  const isCustomized = (action: ShortcutAction) => {
    const keys = shortcuts[action].keys;
    const defaultKeys = defaults[action].keys;
    return (
      keys.length !== defaultKeys.length || keys.some((key, index) => key !== defaultKeys[index])
    );
  };
  const hasCustomShortcuts = (Object.keys(shortcuts) as ShortcutAction[]).some(isCustomized);

  const resetAll = () => {
    stopListening();
    persist(getDefaultShortcuts());
  };

  const confirmReplacement = () => {
    if (!pendingReplacement) return;
    persist(
      setShortcutBinding(
        shortcutsRef.current,
        pendingReplacement.action,
        pendingReplacement.binding,
      ),
    );
    setPendingReplacement(null);
  };

  return (
    <div ref={rootRef} className='w-full'>
      <SubPageHeader
        parentLabel={_('Behavior')}
        currentLabel={_('Keyboard Shortcuts')}
        description={_('Choose the keyboard keys or mouse buttons that control Readest.')}
        onBack={onBack}
        rightSlot={
          <button
            type='button'
            className='btn btn-ghost btn-xs'
            onClick={resetAll}
            disabled={!hasCustomShortcuts}
          >
            {_('Reset all')}
          </button>
        }
      />

      <div className='space-y-6 px-4 pb-4'>
        {SHORTCUT_SECTIONS.map((section) => {
          const actions = (Object.keys(shortcuts) as ShortcutAction[]).filter(
            (action) => shortcuts[action].section === section,
          );
          if (actions.length === 0) return null;
          return (
            <BoxedList key={section} title={_(section)}>
              {actions.map((action) => {
                const entry = shortcuts[action];
                const keys = filterPlatformKeys(entry.keys, isMac);
                const isListening = listening === action;
                const bindingLabel = keys.map((key) => formatKeyForDisplay(key, isMac)).join(' / ');
                return (
                  <SettingsRow
                    key={action}
                    label={_(entry.description)}
                    className='flex-wrap py-2'
                    data-setting-id={`settings.control.keyboardShortcuts.${action}`}
                  >
                    <div className='ms-auto flex max-w-full flex-wrap items-center justify-end gap-2'>
                      {isCustomized(action) && !isListening && (
                        <button
                          type='button'
                          className='text-base-content/65 hover:text-base-content text-[0.8em] focus-visible:underline focus-visible:outline-none'
                          onClick={() =>
                            persist(resetShortcutBinding(shortcutsRef.current, action))
                          }
                        >
                          {_('Reset')}
                        </button>
                      )}
                      {entry.keys.length > 0 && !isListening && (
                        <button
                          type='button'
                          className='text-base-content/65 hover:text-base-content text-[0.8em] focus-visible:underline focus-visible:outline-none'
                          aria-label={`${_('Clear')}: ${_(entry.description)}`}
                          onClick={() =>
                            persist(setShortcutBinding(shortcutsRef.current, action, null))
                          }
                        >
                          {_('Clear')}
                        </button>
                      )}
                      <button
                        type='button'
                        className={
                          isListening
                            ? 'btn btn-contrast btn-sm h-8 min-h-8'
                            : 'eink-bordered border-base-300 bg-base-200/70 hover:bg-base-300/70 min-h-8 rounded-md border px-2 text-[0.8em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15'
                        }
                        aria-pressed={isListening}
                        aria-label={`${_(entry.description)}: ${isListening ? _('Listening…') : bindingLabel || _('Set key')}`}
                        onClick={() => (isListening ? stopListening() : setListening(action))}
                      >
                        {isListening ? _('Listening…') : bindingLabel || _('Set key')}
                      </button>
                    </div>
                  </SettingsRow>
                );
              })}
            </BoxedList>
          );
        })}
      </div>

      {pendingReplacement && (
        <ModalPortal>
          <Alert
            title={_('Replace shortcut?')}
            message={_('The shortcut {{shortcut}} is already assigned to {{actions}}.', {
              shortcut: formatKeyForDisplay(pendingReplacement.binding, isMac),
              actions: pendingReplacement.conflicts
                .map((action) => _(shortcuts[action].description))
                .join(', '),
            })}
            confirmLabel={_('Replace')}
            confirmButtonClassName='btn-contrast'
            onCancel={() => setPendingReplacement(null)}
            onConfirm={confirmReplacement}
          />
        </ModalPortal>
      )}
    </div>
  );
};

export default KeyboardShortcutsSettings;
