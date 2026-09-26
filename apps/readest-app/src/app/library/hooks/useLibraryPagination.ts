import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { eventDispatcher } from '@/utils/event';
import { isPencilNativeKey, normalizeDomKeyEvent, resolvePageTurn } from '@/utils/keybinding';

export function useLibraryPagination(scroller: HTMLElement | null, enabled: boolean) {
  const { appService } = useEnv();
  const hardware = useSettingsStore((s) => s.settings.hardwarePageTurner);

  const turnPage = useCallback(
    (direction: number) => {
      if (!scroller) return;
      const viewport = scroller.getBoundingClientRect();
      const top = scroller.scrollTop;
      const height = scroller.clientHeight;
      const anchors: { top: number; bottom: number }[] = [];
      let headingTop: number | undefined;
      for (const row of scroller.querySelectorAll<HTMLElement>('[data-page-row]')) {
        const bounds = row.getBoundingClientRect();
        const rowTop = bounds.top - viewport.top + top;
        if (row.dataset['pageRow'] === 'heading' || row.dataset['pageRow'] === 'divider') {
          headingTop ??= rowTop;
        } else {
          anchors.push({ top: headingTop ?? rowTop, bottom: bounds.bottom - viewport.top + top });
          headingTop = undefined;
        }
      }
      // Repeat a partly visible row on the next page. Group headings/dividers
      // with their first row rather than leaving a heading alone at the bottom.
      const target =
        direction > 0
          ? anchors.find((row) => row.bottom > top + height + 1)
          : anchors.find((row) => row.top >= top - height - 1 && row.top < top - 1);
      // A single oversized row (for example a large-cover carousel) still needs
      // to be traversable. Never skip its middle or get stuck on its heading.
      const next =
        target && (direction > 0 ? target.top > top + 1 : target.top < top - 1)
          ? target.top
          : top + direction * height;
      scroller.scrollTo({ top: Math.max(0, next), behavior: 'instant' });
    },
    [scroller],
  );

  useEffect(() => {
    if (!enabled || !scroller) return;
    const blocked = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : document.activeElement;
      return (
        (element instanceof HTMLElement &&
          !!element.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          )) ||
        Array.from(
          document.querySelectorAll<HTMLElement>(
            'dialog[open], [role="dialog"], [role="menu"], [data-capture-blocking-overlay="true"], [data-shortcut-recording="true"]',
          ),
        ).some((el) => el.getClientRects().length > 0)
      );
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || blocked(event.target)) return;
      const action = hardware && resolvePageTurn(hardware, normalizeDomKeyEvent(event));
      let direction = action === 'pagePrev' ? -1 : action === 'pageNext' ? 1 : 0;
      if (!action && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey)
        direction = event.key === 'PageUp' ? -1 : event.key === 'PageDown' ? 1 : 0;
      if (!direction) return;
      // Preserve native activation of focused controls even if Enter/Space is bound.
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        event.target instanceof HTMLElement &&
        event.target.closest('button, a, [role="button"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) turnPage(direction);
    };
    const onNativeKey = (event: CustomEvent) => {
      if (blocked(document.activeElement) || !hardware) return;
      const action = resolvePageTurn(hardware, { source: 'native', id: event.detail?.keyName });
      if (action === 'pagePrev' || action === 'pageNext') turnPage(action === 'pagePrev' ? -1 : 1);
    };
    const nativeBindings = hardware?.enabled
      ? [hardware.bindings.pagePrev, hardware.bindings.pageNext].filter(
          (b) => b?.source === 'native',
        )
      : [];
    const device = useDeviceControlStore.getState();
    const intercept =
      appService?.isMobileApp && nativeBindings.some((b) => b && !isPencilNativeKey(b.id));
    if (intercept) device.acquirePageTurnerKeyInterception();
    if (appService?.isMobileApp && nativeBindings.length) device.ensureKeyForwarding();
    window.addEventListener('keydown', onKey, true);
    eventDispatcher.on('native-key-down', onNativeKey);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      eventDispatcher.off('native-key-down', onNativeKey);
      if (intercept) device.releasePageTurnerKeyInterception();
    };
  }, [enabled, scroller, hardware, appService, turnPage]);

  return turnPage;
}
