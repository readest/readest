/**
 * A bottom sheet must be dismissible with a downward swipe that starts anywhere
 * on it, not only on the 24px drag handle at its top edge (#6089): after reading
 * a dictionary entry the thumb sits near the bottom of the phone, and reaching
 * the handle takes a second hand.
 *
 * Scrollable content owns its gestures at every scroll position, including
 * overscroll at the top. Text fields also keep their gestures.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasHaptics: true } }),
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

const { impactFeedback } = await import('@tauri-apps/plugin-haptics');

const { default: Dialog } = await import('@/components/Dialog');

// jsdom has no Touch/TouchEvent constructors; Dialog and useDrag only read
// touches[0].clientX/clientY, so a plain Event with the fields grafted on is a
// faithful stand-in.
const touchEvent = (type: string, x: number, y: number): Event => {
  const event = new Event(type, { bubbles: true });
  const touch = { clientX: x, clientY: y };
  Object.assign(event, { touches: [touch], changedTouches: [touch] });
  return event;
};

// jsdom reports every scroll metric as 0; pin the one the gesture reads.
const mockScrollTop = (el: HTMLElement, scrollTop: number) =>
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop });

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

const swipeDown = (from: HTMLElement) => {
  from.dispatchEvent(touchEvent('touchstart', 100, 300));
  from.dispatchEvent(touchEvent('touchmove', 100, 320));
  window.dispatchEvent(touchEvent('touchmove', 100, 800));
  window.dispatchEvent(touchEvent('touchend', 100, 800));
};

const Sheet = ({ onClose }: { onClose: () => void }) => (
  <Dialog isOpen snapHeight={0.75} title='Dictionary' onClose={onClose}>
    <div data-testid='scroller'>
      <p data-testid='entry'>a house is a building for people to live in</p>
      <textarea data-testid='note' defaultValue='' />
    </div>
  </Dialog>
);

beforeEach(() => {
  vi.clearAllMocks();
  setViewport(390, 844);
});
afterEach(() => cleanup());

describe('Dialog swipe-to-dismiss', () => {
  it('dismisses on a downward swipe that starts in the sheet body', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);

    swipeDown(screen.getByTestId('entry'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('light');
  });

  it('still dismisses on a downward swipe from the drag handle', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);

    swipeDown(document.querySelector('.drag-handle') as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('light');
  });

  it('leaves the gesture to a scroller that is already scrolled', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const scroller = screen.getByTestId('scroller');
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 200 },
    });
    mockScrollTop(scroller, 40);

    swipeDown(screen.getByTestId('entry'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([0, -20, 400])('leaves scrollable content alone at scrollTop %s', (scrollTop) => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const scroller = screen.getByTestId('scroller');
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 200 },
    });
    mockScrollTop(scroller, scrollTop);

    swipeDown(screen.getByTestId('entry'));

    expect(onClose).not.toHaveBeenCalled();
    expect(impactFeedback).not.toHaveBeenCalled();
    expect(document.querySelector('.drag-shield')).toBeNull();
  });

  it('allows dismissal from the header above scrollable content', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const scroller = screen.getByTestId('scroller');
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, {
      scrollHeight: { value: 600 },
      clientHeight: { value: 200 },
    });

    swipeDown(document.querySelector('.dialog-header') as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('light');
  });

  it('leaves horizontal scrollable content alone', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const scroller = screen.getByTestId('scroller');
    scroller.style.overflowX = 'auto';
    Object.defineProperties(scroller, {
      scrollWidth: { value: 600 },
      clientWidth: { value: 200 },
    });

    swipeDown(screen.getByTestId('entry'));

    expect(onClose).not.toHaveBeenCalled();
    expect(impactFeedback).not.toHaveBeenCalled();
  });

  it.each([
    true,
    false,
  ])('does not vibrate when a drag returns to the sheet (snap: %s)', (snapped) => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen snapHeight={snapped ? 0.75 : undefined} onClose={onClose}>
        Body
      </Dialog>,
    );
    const handle = document.querySelector('.drag-handle') as HTMLElement;
    act(() => {
      handle.dispatchEvent(touchEvent('touchstart', 100, 300));
      window.dispatchEvent(touchEvent('touchend', 100, 299));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(impactFeedback).not.toHaveBeenCalled();
  });

  it('leaves the gesture to a text field', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);

    swipeDown(screen.getByTestId('note'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a sideways swipe', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);

    const entry = screen.getByTestId('entry');
    entry.dispatchEvent(touchEvent('touchstart', 100, 300));
    entry.dispatchEvent(touchEvent('touchmove', 220, 310));
    window.dispatchEvent(touchEvent('touchmove', 300, 800));
    window.dispatchEvent(touchEvent('touchend', 300, 800));

    expect(onClose).not.toHaveBeenCalled();
  });

  // The system can take the touch away after the swipe has already become a
  // drag — an edge-swipe back gesture, the notification shade. That is not a
  // decision to dismiss, and it must not leave the drag half-finished: the
  // viewport-wide shield useDrag installs would swallow every later tap.
  it('restores the sheet when the system cancels a swipe already under way', () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const modal = document.querySelector('.modal-box') as HTMLElement;

    const entry = screen.getByTestId('entry');
    entry.dispatchEvent(touchEvent('touchstart', 100, 300));
    entry.dispatchEvent(touchEvent('touchmove', 100, 320));
    window.dispatchEvent(touchEvent('touchmove', 100, 700));
    expect(document.querySelector('.drag-shield')).not.toBeNull();

    window.dispatchEvent(touchEvent('touchcancel', 100, 700));

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.drag-shield')).toBeNull();
    // Back to its resting snap, not left wherever the finger was.
    expect(impactFeedback).not.toHaveBeenCalled();
    expect(modal.style.height).toBe('75%');
    expect(modal.style.transform).toBe('');
  });

  it('does not dismiss on a desktop-sized viewport', () => {
    setViewport(1440, 900);
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);

    swipeDown(screen.getByTestId('entry'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
