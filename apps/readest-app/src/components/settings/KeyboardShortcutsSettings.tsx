import React, { useEffect, useRef, useState } from 'react';
import ModalPortal from '@/components/ModalPortal';
import {
  addShortcutBinding,
  getDefaultShortcuts,
  getShortcutConflicts,
  getVisibleShortcutKeys,
  isShortcutCustomized,
  loadShortcuts,
  removeShortcutBinding,
  resetShortcutBinding,
  saveShortcuts,
  SHORTCUT_SECTIONS,
  ShortcutAction,
  ShortcutConfig,
} from '@/helpers/shortcuts';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { isMacPlatform } from '@/services/environment';
import {
  formatKeyForDisplay,
  getShortcutFromKeyboardEvent,
  getShortcutFromMouseEvent,
} from '@/utils/shortcutKeys';
import { MdAdd, MdClose, MdRestartAlt } from 'react-icons/md';
import SubPageHeader from './SubPageHeader';
import { BoxedList, SettingsRow } from './primitives';

const LEARN_TIMEOUT_MS = 15000;
// Add / Reset / Remove stay out of the way on pointer devices — 50-odd rows
// each carrying permanent buttons reads as clutter. They are always visible
// where hover doesn't exist: touch widths (<sm) and e-ink.
const ROW_ACTION_CLASS =
  'touch-target hover:bg-base-200/60 focus-visible:bg-base-200/60 flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none not-eink:sm:opacity-0 not-eink:sm:group-hover:opacity-100 not-eink:sm:group-focus-within:opacity-100';
const KEY_REMOVE_CLASS =
  'hover:bg-base-200/60 focus-visible:bg-base-200/60 flex h-full w-6 shrink-0 items-center justify-center rounded-e-md transition-colors duration-150 focus-visible:outline-none not-eink:sm:hidden not-eink:sm:group-hover/key:flex not-eink:sm:group-focus-within/key:flex';

// `replacing` is the binding being re-recorded; null adds a new one.
type Recording = {
  action: ShortcutAction;
  replacing: string | null;
};

type PendingReplacement = Recording & {
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
  const [listening, setListening] = useState<Recording | null>(null);
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
    const { action, replacing } = listening;
    const conflicts = getShortcutConflicts(shortcutsRef.current, action, binding);
    stopListening();
    if (conflicts.length > 0) {
      setPendingReplacement({ action, replacing, binding, conflicts });
      return;
    }
    persist(addShortcutBinding(shortcutsRef.current, action, binding, isMac, replacing));
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
    const { action, binding, replacing } = pendingReplacement;
    persist(addShortcutBinding(shortcutsRef.current, action, binding, isMac, replacing));
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
                const keys = getVisibleShortcutKeys(shortcuts, action, isMac);
                const isListening = listening?.action === action;
                const listeningButton = (
                  <button
                    type='button'
                    className='btn btn-contrast btn-sm h-8 min-h-8'
                    aria-pressed
                    aria-label={`${_(entry.description)}: ${_('Listening…')}`}
                    onClick={stopListening}
                  >
                    {_('Listening…')}
                  </button>
                );
                return (
                  <SettingsRow
                    key={action}
                    className='group'
                    label={_(entry.description)}
                    data-setting-id={`settings.control.keyboardShortcuts.${action}`}
                  >
                    <div className='ms-auto flex max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-1'>
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
                      {keys.length > 0 && !isListening && (
                        <button
                          type='button'
                          className={ROW_ACTION_CLASS}
                          aria-label={`${_('Add')}: ${_(entry.description)}`}
                          title={_('Add')}
                          onClick={() => setListening({ action, replacing: null })}
                        >
                          <MdAdd aria-hidden='true' className='h-4 w-4' />
                        </button>
                      )}
                      {keys.map((key) => {
                        if (isListening && listening.replacing === key) {
                          return <React.Fragment key={key}>{listeningButton}</React.Fragment>;
                        }
                        const label = formatKeyForDisplay(key, isMac);
                        return (
                          <span
                            key={key}
                            className='group/key border-base-300 eink-bordered flex h-7 shrink-0 items-center rounded-md border'
                          >
                            <button
                              type='button'
                              className='hover:bg-base-200/60 focus-visible:bg-base-200/60 h-full rounded-md px-2 text-[0.8em] transition-colors duration-150 focus-visible:outline-none'
                              aria-label={`${_(entry.description)}: ${label}`}
                              title={label}
                              onClick={() => setListening({ action, replacing: key })}
                            >
                              {label}
                            </button>
                            {!isListening && (
                              <button
                                type='button'
                                className={KEY_REMOVE_CLASS}
                                aria-label={`${_('Remove')}: ${_(entry.description)} (${label})`}
                                title={_('Remove')}
                                onClick={() =>
                                  persist(
                                    removeShortcutBinding(shortcutsRef.current, action, key, isMac),
                                  )
                                }
                              >
                                <MdClose aria-hidden='true' className='h-3.5 w-3.5' />
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {isListening && listening.replacing === null && listeningButton}
                      {keys.length === 0 && !isListening && (
                        <button
                          type='button'
                          className='hover:bg-base-200/60 focus-visible:bg-base-200/60 min-h-8 rounded-md px-2 text-end text-[0.8em] transition-colors duration-150 focus-visible:outline-none'
                          aria-label={`${_(entry.description)}: ${_('Set key')}`}
                          onClick={() => setListening({ action, replacing: null })}
                        >
                          {_('Set key')}
                        </button>
                      )}
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
