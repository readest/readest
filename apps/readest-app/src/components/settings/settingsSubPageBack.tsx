import React, { createContext, useContext, useEffect, useRef } from 'react';

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

/** Test-only reset for the module-level stack. */
export const resetSettingsSubPageBackStack = () => {
  backStack.length = 0;
};

/**
 * Registers `onBack` as the Escape/Back target while this sub-page is mounted.
 * The handler is read through a ref so an inline arrow does not re-register on
 * every render (which would also reshuffle the stack).
 */
export const useSettingsSubPageBack = (onBack: () => void) => {
  const inSettings = useContext(InSettingsScope);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!inSettings) return;
    const handler = () => onBackRef.current();
    backStack.push(handler);
    return () => {
      const index = backStack.lastIndexOf(handler);
      if (index >= 0) backStack.splice(index, 1);
    };
  }, [inSettings]);
};
