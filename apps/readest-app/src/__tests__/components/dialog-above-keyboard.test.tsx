/**
 * #6390: the phone note editor is a bottom sheet with a text area. Under the
 * on-screen keyboard its Save/Cancel were hidden and the page panned to reveal
 * the caret. The sheet now rests on the keyboard instead.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
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

const LAYOUT_HEIGHT = 872;
const viewport = Object.assign(new EventTarget(), { height: LAYOUT_HEIGHT, offsetTop: 0 });

const showKeyboard = (keyboardHeight: number, pan = 0) =>
  act(() => {
    viewport.height = LAYOUT_HEIGHT - keyboardHeight;
    viewport.offsetTop = pan;
    viewport.dispatchEvent(new Event('resize'));
  });

const sheet = () => screen.getByTestId('note').closest('.modal-box') as HTMLElement;

const touch = (type: string, y: number) => {
  const t = { clientX: 100, clientY: y };
  return Object.assign(new Event(type, { bubbles: true }), { touches: [t], changedTouches: [t] });
};

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 392 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: LAYOUT_HEIGHT });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: LAYOUT_HEIGHT,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  document.documentElement.scrollIntoView = vi.fn();
  viewport.height = LAYOUT_HEIGHT;
  viewport.offsetTop = 0;
});
afterEach(() => cleanup());

describe('Dialog aboveKeyboard', () => {
  it('rests the sheet on the keyboard at once, without sliding there', () => {
    render(
      <Dialog isOpen snapHeight={0.3} aboveKeyboard title='Note' onClose={vi.fn()}>
        <textarea data-testid='note' />
      </Dialog>,
    );
    expect(sheet().style.bottom).toBe('0px');

    showKeyboard(337);
    expect(sheet().style.bottom).toBe('337px');
    expect(sheet().style.transition).not.toMatch(/bottom/);

    showKeyboard(0);
    expect(sheet().style.bottom).toBe('0px');
  });

  // The webview may pan the page by the keyboard to reveal the caret before
  // the sheet is up; netting that pan out of the lift left the sheet at the
  // bottom and the page panned for good.
  it('lifts by the whole keyboard and takes back a pan the webview made', () => {
    render(
      <Dialog isOpen snapHeight={0.3} aboveKeyboard title='Note' onClose={vi.fn()}>
        <textarea data-testid='note' />
      </Dialog>,
    );

    showKeyboard(337, 337);

    expect(sheet().style.bottom).toBe('337px');
    expect(document.documentElement.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('puts the keyboard away when the sheet is dragged, so the page cannot pan', () => {
    render(
      <Dialog isOpen snapHeight={0.3} aboveKeyboard title='Note' onClose={vi.fn()}>
        <textarea data-testid='note' />
      </Dialog>,
    );
    const note = screen.getByTestId('note');
    note.focus();

    act(() => {
      sheet().querySelector('.drag-handle')!.dispatchEvent(touch('touchstart', 440));
    });

    expect(document.activeElement).not.toBe(note);
  });

  // Lifted onto the keyboard, the sheet's top sits high on the screen, so a
  // short pull down used to end above the snap band and expand the sheet to
  // full height. Pulling down means lower, never taller.
  it('settles a short pull down from the lifted position at its resting height', () => {
    render(
      <Dialog isOpen snapHeight={0.3} aboveKeyboard title='Note' onClose={vi.fn()}>
        <textarea data-testid='note' />
      </Dialog>,
    );
    showKeyboard(337);
    const handle = sheet().querySelector('.drag-handle')!;
    // A slow pull (60px over a second), so velocity alone does not dismiss.
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    act(() => {
      handle.dispatchEvent(touch('touchstart', 100));
      showKeyboard(0);
      window.dispatchEvent(touch('touchmove', 130));
      window.dispatchEvent(touch('touchmove', 160));
      now.mockReturnValue(1000);
      window.dispatchEvent(touch('touchend', 160));
    });
    now.mockRestore();

    expect(sheet().style.height).toBe('30%');
  });

  it('leaves sheets that did not ask for it at the bottom', () => {
    render(
      <Dialog isOpen snapHeight={0.3} title='Dictionary' onClose={vi.fn()}>
        <textarea data-testid='note' />
      </Dialog>,
    );
    showKeyboard(337);
    expect(sheet().style.bottom).toBe('0px');
  });
});
