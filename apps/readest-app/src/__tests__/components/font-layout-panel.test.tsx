// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FontLayoutPanel } from '@/app/reader/components/footerbar/FontLayoutPanel';
import { useSettingsStore } from '@/store/settingsStore';

// A store hook called with a selector, or without one for the whole state.
const { storeHook } = vi.hoisted(() => ({
  storeHook:
    <T extends object>(state: () => T) =>
    (select?: (s: T) => unknown) =>
      select ? select(state()) : state(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isAndroidApp: false } }),
}));

vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

const setHoveredBookKeyMock = vi.fn();
vi.mock('@/store/readerStore', () => ({
  useReaderStore: storeHook(() => ({
    viewStates: {},
    getView: () => null,
    getViewSettings: () => ({
      defaultFontSize: 16,
      lineHeight: 1.6,
      marginTopPx: 44,
      gapPercent: 5,
    }),
    setHoveredBookKey: setHoveredBookKeyMock,
  })),
}));

afterEach(() => {
  cleanup();
  setHoveredBookKeyMock.mockReset();
  useSettingsStore.setState({
    requestedPanel: null,
    settingsDialogBookKey: '',
    isSettingsDialogOpen: false,
  });
});

describe('FontLayoutPanel More Settings', () => {
  it('deep-links to the Font panel and dismisses the footer bar', () => {
    render(
      <FontLayoutPanel
        bookKey='book-1'
        actionTab='font'
        bottomOffset='64px'
        marginIconSize={20}
        forceMobileLayout={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More Settings' }));

    const state = useSettingsStore.getState();
    expect(state.requestedPanel).toBe('Font');
    expect(state.settingsDialogBookKey).toBe('book-1');
    expect(state.isSettingsDialogOpen).toBe(true);
    // The footer bar is tied to hoveredBookKey; leaving it set would strand the
    // bar behind the dialog, which is why the header button used to clear it.
    expect(setHoveredBookKeyMock).toHaveBeenCalledWith('');
  });
});
