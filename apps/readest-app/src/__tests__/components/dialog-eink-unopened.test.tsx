/**
 * On an e-ink device a dialog that has never opened renders its <dialog> element alone.
 *
 * The library mounts a dozen closed dialogs that its menus open by id; their chrome (overlay,
 * sheet, title bar, buttons) took ~0.5 s of a Kindle's launch to render, for windows nobody may
 * open. E-ink has no open animation to keep, so the chrome waits for the first open there; other
 * devices render it from the start, so the box's open animation runs on the first open too.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

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
  <Dialog id='about_window' isOpen={isOpen} title='About Readest' onClose={vi.fn()}>
    {isOpen && <p>Version 0.12.1</p>}
  </Dialog>
);

afterEach(() => {
  cleanup();
  delete window.__READEST_IS_EINK;
});

describe('a dialog that has never opened', () => {
  it('is only its element on e-ink, until it opens; then it keeps its chrome', () => {
    window.__READEST_IS_EINK = true;
    const { container, rerender } = render(<Harness isOpen={false} />);
    const dialog = container.querySelector('dialog#about_window');
    expect(dialog).not.toBeNull();
    expect(dialog!.childElementCount).toBe(0);

    rerender(<Harness isOpen />);
    expect(container.querySelector('dialog#about_window')).toBe(dialog);
    expect(dialog!.querySelector('.modal-box')?.textContent).toContain('Version 0.12.1');

    rerender(<Harness isOpen={false} />);
    expect(dialog!.querySelector('.modal-box')).not.toBeNull();
  });

  it('has its chrome from the start elsewhere', () => {
    const { container } = render(<Harness isOpen={false} />);
    expect(container.querySelector('dialog#about_window .modal-box')).not.toBeNull();
  });
});
