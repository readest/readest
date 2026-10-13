/**
 * A mobile sheet that takes its height from its content (a confirmation) sits
 * at the bottom of the screen: it neither clears the status bar nor needs a
 * back button, since the drag handle, the backdrop and its own actions all
 * dismiss it. A sheet that fills the screen keeps both.
 *
 * Needs real layout and the real stylesheet, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasSafeAreaInset: true } }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 47, right: 0, bottom: 34, left: 0 },
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
await import('@/styles/globals.css');

const box = () => document.querySelector('.modal-box') as HTMLElement;
const visibleCloseButtons = () =>
  Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Close"]')).filter(
    (button) => getComputedStyle(button).display !== 'none',
  );

describe('Dialog on a phone', () => {
  afterEach(() => {
    cleanup();
  });

  it('drops the status bar padding and the back button on a content-height sheet', async () => {
    await page.viewport(390, 844);
    render(
      <Dialog
        isOpen
        title='Delete bookshelf?'
        boxClassName='h-auto! max-h-[80vh]!'
        onClose={vi.fn()}
      >
        <p>Your books will stay in the library.</p>
      </Dialog>,
    );
    await expect.poll(() => getComputedStyle(box()).paddingTop).toBe('0px');
    expect(visibleCloseButtons()).toHaveLength(0);
  });

  it('keeps a content-height sheet short after it is dragged up', async () => {
    // Releasing an upward drag takes a sheet to full height: the handlers set
    // an inline height of 100%, which the caller's !important height outranks,
    // so the sheet stays short and needs neither the back button nor the
    // status bar padding.
    await page.viewport(390, 844);
    const onClose = vi.fn();
    render(
      <Dialog
        isOpen
        title='Delete bookshelf?'
        boxClassName='h-auto! max-h-[80vh]!'
        onClose={onClose}
      >
        <p>Your books will stay in the library.</p>
      </Dialog>,
    );
    await expect.poll(() => getComputedStyle(box()).paddingTop).toBe('0px');
    const handle = document.querySelector('.drag-handle') as HTMLElement;
    const y = handle.getBoundingClientRect().top + 4;
    fireEvent.mouseDown(handle, { clientY: y });
    fireEvent.mouseMove(window, { clientY: y - 300 });
    fireEvent.mouseUp(window, { clientY: y - 300 });

    await expect.poll(() => box().style.height).toBe('100%');
    expect(onClose).not.toHaveBeenCalled();
    expect(box().offsetHeight).toBeLessThan(
      (document.querySelector('dialog') as HTMLElement).clientHeight,
    );
    expect(getComputedStyle(box()).paddingTop).toBe('0px');
    expect(visibleCloseButtons()).toHaveLength(0);
  });

  it('has no back button on a sheet snapped short of the screen', async () => {
    await page.viewport(390, 844);
    render(
      <Dialog isOpen title='Notes' snapHeight={0.5} onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    await expect.poll(() => getComputedStyle(box()).paddingTop).toBe('0px');
    expect(visibleCloseButtons()).toHaveLength(0);
  });

  it('keeps both on a sheet that fills the screen', async () => {
    await page.viewport(390, 844);
    render(
      <Dialog isOpen title='Settings' onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    await expect.poll(() => getComputedStyle(box()).paddingTop).toBe('47px');
    expect(visibleCloseButtons()).toHaveLength(1);
  });
});
