/**
 * A dialog must disappear in one piece.
 *
 * Every caller gates the dialog body on the same flag it passes as `isOpen`
 * (`<Dialog isOpen={isOpen}>{isOpen && <Body />}</Dialog>`), so the body
 * unmounted on the frame the close started while the modal box was still
 * fading out: the box collapsed onto its title bar, which then faded away on
 * its own. Keep the last body on screen until the close transition is over.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

const { default: Dialog } = await import('@/components/Dialog');

const Harness = ({ isOpen }: { isOpen: boolean }) => (
  <Dialog isOpen={isOpen} title='About Readest' onClose={vi.fn()}>
    {isOpen && <p>Version 0.12.1</p>}
  </Dialog>
);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Dialog close', () => {
  it('keeps the body while the dialog fades out', () => {
    const { rerender } = render(<Harness isOpen />);
    expect(screen.getByText('Version 0.12.1')).toBeTruthy();

    rerender(<Harness isOpen={false} />);
    expect(screen.queryByText('Version 0.12.1')).toBeTruthy();

    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText('Version 0.12.1')).toBeNull();
  });

  it('shows the new body when the dialog reopens', () => {
    const { rerender } = render(<Harness isOpen />);
    rerender(<Harness isOpen={false} />);
    rerender(<Harness isOpen />);

    act(() => vi.advanceTimersByTime(300));
    expect(screen.getAllByText('Version 0.12.1')).toHaveLength(1);
  });
});
