import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from '@/components/ModalPortal';
import {
  getDefaultShortcuts,
  getShortcutConflicts,
  isShortcutCustomized,
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
import { MdClose, MdRestartAlt } from 'react-icons/md';
import SubPageHeader from './SubPageHeader';
import { BoxedList, SettingsRow } from './primitives';

const LEARN_TIMEOUT_MS = 15000;
// Clear / Reset stay out of the way on pointer devices — 50-odd rows each
// carrying a permanent ✕ reads as clutter. They are always visible where
// hover doesn't exist: touch widths (<sm) and e-ink.
const ROW_ACTION_CLASS =
  'touch-target hover:bg-base-200/60 focus-visible:bg-base-200/60 flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none not-eink:sm:opacity-0 not-eink:sm:group-hover:opacity-100 not-eink:sm:group-focus-within:opacity-100';

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
  const replacementDialogRef = useRef<HTMLDivElement>(null);
  useKeyDownActions({ onCancel: onBack, enabled: !listening && !pendingReplacement });

  useEffect(() => {
    const syncShortcuts = () => {
      const next = loadShortcuts();
      shortcutsRef.current = next;
      setShortcuts(next);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'customShortcuts' || event.key === null) syncShortcuts();
    };
    window.addEventListener('shortcutUpdate', syncShortcuts);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('shortcutUpdate', syncShortcuts);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

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

  useEffect(() => {
    if (!pendingReplacement) return;
    const dialog = replacementDialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    buttons?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPendingReplacement(null);
        return;
      }
      if (event.key !== 'Tab' || !buttons?.length) return;
      const first = buttons[0]!;
      const last = buttons[buttons.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog?.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [pendingReplacement]);

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

  const hasCustomShortcuts = (Object.keys(shortcuts) as ShortcutAction[]).some((action) =>
    isShortcutCustomized(shortcuts, action),
  );

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
    <div ref={rootRef} className='w-full' data-shortcut-recording={listening ? 'true' : undefined}>
      <SubPageHeader
        parentLabel={_('Behavior')}
        currentLabel={_('Keyboard Shortcuts')}
        description={_('Choose the keyboard keys or mouse buttons that control Readest.')}
        onBack={onBack}
        rightSlot={
          <button
            type='button'
            className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
            onClick={resetAll}
            disabled={!hasCustomShortcuts}
          >
            {_('Reset all')}
          </button>
        }
      />

      {/* No px-4 here: BoxedList's `SectionTitle` carries its own `ps-4`, so the
          group titles line up with the SubPageHeader breadcrumb and the cards
          bleed to the panel edge — the same shape as the Integrations panel. */}
      <div className='space-y-6 pb-4'>
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
                    className='group'
                    label={_(entry.description)}
                    data-setting-id={`settings.control.keyboardShortcuts.${action}`}
                  >
                    <div className='ms-auto flex max-w-[60%] shrink-0 items-center justify-end gap-1'>
                      {isShortcutCustomized(shortcuts, action) && !isListening && (
                        <button
                          type='button'
                          className={ROW_ACTION_CLASS}
                          aria-label={`${_('Reset')}: ${_(entry.description)}`}
                          title={_('Reset')}
                          onClick={() =>
                            persist(resetShortcutBinding(shortcutsRef.current, action))
                          }
                        >
                          <MdRestartAlt aria-hidden='true' className='h-4 w-4' />
                        </button>
                      )}
                      {entry.keys.length > 0 && !isListening && (
                        <button
                          type='button'
                          className={ROW_ACTION_CLASS}
                          aria-label={`${_('Clear')}: ${_(entry.description)}`}
                          title={_('Clear')}
                          onClick={() =>
                            persist(setShortcutBinding(shortcutsRef.current, action, null))
                          }
                        >
                          <MdClose aria-hidden='true' className='h-4 w-4' />
                        </button>
                      )}
                      <button
                        type='button'
                        className={
                          isListening
                            ? 'btn btn-contrast btn-sm h-8 min-h-8'
                            : 'hover:bg-base-200/60 focus-visible:bg-base-200/60 min-h-8 min-w-0 flex-1 truncate rounded-md px-2 text-end text-[0.8em] transition-colors duration-150 focus-visible:outline-none'
                        }
                        aria-pressed={isListening}
                        aria-label={`${_(entry.description)}: ${isListening ? _('Listening…') : bindingLabel || _('Set key')}`}
                        title={bindingLabel || _('Set key')}
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
          {/* daisyUI 5 keeps `.modal-box` at opacity 0 / scale .95 unless it
              sits inside an open `.modal` — without this wrapper the dialog
              lays out but never paints. */}
          <dialog className='modal modal-open'>
            <div
              ref={replacementDialogRef}
              role='alertdialog'
              aria-modal='true'
              aria-labelledby='shortcut-replacement-title'
              aria-describedby='shortcut-replacement-description'
              className='modal-box bg-base-100 w-[min(420px,calc(100vw-2rem))] rounded-2xl p-5'
            >
              <h3 id='shortcut-replacement-title' className='mb-1.5 font-semibold tracking-tight'>
                {_('Replace shortcut?')}
              </h3>
              <p
                id='shortcut-replacement-description'
                className='text-base-content/70 leading-relaxed'
              >
                {_('The shortcut {{shortcut}} is already assigned to {{actions}}.', {
                  shortcut: formatKeyForDisplay(pendingReplacement.binding, isMac),
                  actions: pendingReplacement.conflicts
                    .map((action) => _(shortcuts[action].description))
                    .join(', '),
                })}
              </p>
              <div className='mt-5 flex justify-end gap-2'>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm h-8 min-h-8'
                  onClick={() => setPendingReplacement(null)}
                >
                  {_('Cancel')}
                </button>
                <button
                  type='button'
                  className='btn btn-contrast btn-sm h-8 min-h-8'
                  onClick={confirmReplacement}
                >
                  {_('Replace')}
                </button>
              </div>
            </div>
          </dialog>
        </ModalPortal>
      )}
    </div>
  );
};

export default KeyboardShortcutsSettings;
