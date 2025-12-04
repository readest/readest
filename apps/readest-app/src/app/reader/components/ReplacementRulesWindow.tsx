import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';

export const setReplacementRulesWindowVisible = (visible: boolean) => {
  // Persist desired visibility on window so components that mount later can read it
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  window.__REPLACEMENT_RULES_WINDOW_VISIBLE__ = visible;
  const event = new CustomEvent('setReplacementRulesVisibility', {
    detail: { visible },
  });
  // Dispatch on window so listeners attached to window/document will receive it
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(event);
  }
};

export const ReplacementRulesWindow: React.FC = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: Event) => {
      const ev = event as CustomEvent;
      setIsOpen(!!ev.detail?.visible);
    };

    // Initialize from window flag in case the open request fired before mount
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const initial = typeof window !== 'undefined' ? !!window.__REPLACEMENT_RULES_WINDOW_VISIBLE__ : false;
    setIsOpen(initial);

    // Listen on window for visibility events
    if (typeof window !== 'undefined') {
      window.addEventListener('setReplacementRulesVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('setReplacementRulesVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  const globalRules = settings?.globalViewSettings?.replacementRules || [];
  const bookRules = sideBarBookKey ? getViewSettings(sideBarBookKey)?.replacementRules || [] : [];

  return (
    <Dialog
      id='replacement_rules_window'
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('Replacement Rules')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
          <div>
            <h3 className='text-sm font-semibold'>{_('Book Rules')}</h3>
            {bookRules.length === 0 ? (
              <p className='text-sm text-base-content/70 mt-2'>{_('No book-level replacement rules')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {bookRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <div className='font-medium text-sm'>{r.pattern}</div>
                        <div className='text-xs text-base-content/70 break-all'>{r.replacement}</div>
                      </div>
                      <div className='text-xs text-base-content/60 ml-4'>{r.enabled ? _('Enabled') : _('Disabled')}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className='text-sm font-semibold'>{_('Global Rules')}</h3>
            {globalRules.length === 0 ? (
              <p className='text-sm text-base-content/70 mt-2'>{_('No global replacement rules')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {globalRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <div className='font-medium text-sm'>{r.pattern}</div>
                        <div className='text-xs text-base-content/70 break-all'>{r.replacement}</div>
                      </div>
                      <div className='text-xs text-base-content/60 ml-4'>{r.enabled ? _('Enabled') : _('Disabled')}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};

export default ReplacementRulesWindow;
