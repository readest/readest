import React, { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * A settings sub-page's way back, as a stack.
 *
 * Settings nests its pages inside one dialog: Font → Manage Fonts, TTS → Voice
 * Library → a custom service's editor, Integrations → Data Flow → one flow. The
 * dialog owns Escape (and Android Back), so without a stack the first press
 * closes the whole thing instead of stepping out of the page the user is on.
 *
 * Each sub-page that renders a back affordance (`SubPageHeader`, or its own
 * breadcrumb) registers that handler here while it is mounted; the dialog asks
 * the top of the stack first and only closes when there is nothing to step out
 * of. Mount order is depth order — a page registered later is deeper — and the
 * handler is removed on unmount, so going back re-exposes the level above.
 */

type BackHandler = () => void;

const backStack: BackHandler[] = [];

/**
 * True inside the Settings dialog. Sub-page headers also exist in dialogs that
 * bring their own `onBack` (reading stats, catalog manager), and those must not
 * push levels onto the Settings stack.
 */
const InSettingsScope = createContext(false);

export const SettingsSubPageBackScope: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <InSettingsScope.Provider value={true}>{children}</InSettingsScope.Provider>
);

/**
 * Steps back one sub-page level. Returns false when the current page is
 * already the panel itself, which is the caller's cue to close the dialog.
 */
export const stepBackSettingsSubPage = (): boolean => {
  const handler = backStack[backStack.length - 1];
  if (!handler) return false;
  handler();
  return true;
};

/**
 * Every Settings page renders inside the dialog's one scroll viewport, so the
 * offset belongs to whichever page is on screen. A sub-page is usually shorter
 * than the page it covers, and laying it out clamps that page's offset away.
 * So each sub-page records the offset of the page it covers when it mounts
 * (from the last scroll event, before the new layout clamps it), opens at the
 * top, and going back restores the covered page's offset.
 */
let scroller: HTMLElement | null = null;
let lastTop = 0;
/** Pages under the one on screen, shallowest first. `page` is undefined for the panel. */
let covered: { page?: string; top: number }[] = [];
let currentPage: string | undefined;
/** Sub-pages unmounted in this commit that no mount has answered yet. */
let leaving = 0;
let restoreFrame = 0;

const resetScrollState = () => {
  cancelAnimationFrame(restoreFrame);
  scroller = null;
  lastTop = 0;
  covered = [];
  currentPage = undefined;
  leaving = 0;
};

const setTop = (top: number) => {
  cancelAnimationFrame(restoreFrame);
  if (!scroller) return;
  scroller.scrollTop = top;
  lastTop = scroller.scrollTop;
};

/** The page being returned to may still be loading: wait until it can take the offset. */
const restoreTop = (top: number, deadline = performance.now() + 1000) => {
  // A newer restore replaces one still waiting, never the other way round.
  cancelAnimationFrame(restoreFrame);
  const el = scroller;
  if (!el) return;
  if (el.scrollHeight - el.clientHeight < top && performance.now() < deadline) {
    restoreFrame = requestAnimationFrame(() => restoreTop(top, deadline));
    return;
  }
  setTop(top);
};

/** Back to a page that stayed mounted (or to the panel): no sub-page mounted in its place. */
const settleLeaving = () => {
  if (!leaving) return;
  const [page] = covered.splice(Math.max(0, covered.length - leaving));
  leaving = 0;
  if (!page) return;
  currentPage = page.page;
  restoreTop(page.top);
};

/**
 * Follows the Settings viewport for the panel on screen. The returned cleanup
 * drops every recorded offset, so switching tabs or closing never carries a
 * sub-page's way back into the next panel.
 */
export const trackSettingsScroll = (el: HTMLElement) => {
  scroller = el;
  lastTop = el.scrollTop;
  const onScroll = () => {
    lastTop = el.scrollTop;
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    el.removeEventListener('scroll', onScroll);
    resetScrollState();
  };
};

/**
 * Registers `onBack` as the Escape/Back target while this sub-page is mounted.
 * The handler is read through a ref so an inline arrow does not re-register on
 * every render (which would also reshuffle the stack).
 *
 * `page` names the sub-page, so a list that swapped itself for an editor gets
 * its own offset back when the editor swaps back to it.
 */
export const useSettingsSubPageBack = (onBack: () => void, page?: string) => {
  const inSettings = useContext(InSettingsScope);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const pageRef = useRef(page);

  useEffect(() => {
    if (!inSettings) return;
    const handler = () => onBackRef.current();
    backStack.push(handler);
    return () => {
      const index = backStack.lastIndexOf(handler);
      if (index >= 0) backStack.splice(index, 1);
    };
  }, [inSettings]);

  useLayoutEffect(() => {
    if (!inSettings) return;
    const page = pageRef.current;
    const index = page === undefined ? -1 : covered.findIndex((p) => p.page === page);
    if (leaving && page === currentPage) {
      // The same page again: StrictMode's second mount.
      leaving--;
    } else if (index >= 0) {
      // Swapped back to a page a deeper one had replaced.
      const { top } = covered[index]!;
      covered.length = index;
      leaving = 0;
      restoreTop(top);
    } else {
      if (leaving) leaving--;
      covered.push({ page: currentPage, top: lastTop });
      setTop(0);
    }
    currentPage = page;
    return () => {
      // A sub-page mounting in this same commit answers this; otherwise the
      // page underneath is back on screen once the commit is done.
      leaving++;
      queueMicrotask(settleLeaving);
    };
  }, [inSettings]);
};
