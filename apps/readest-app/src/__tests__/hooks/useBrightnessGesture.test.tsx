import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  hasScreenBrightness: true,
  swipeSetting: true,
  scrolled: false,
  screenBrightness: -1,
  autoScreenBrightness: false,
  lastScreenBrightness: null as number | null,
  setScreenBrightness: vi.fn(),
  getScreenBrightness: vi.fn(),
  saveSysSettings: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { hasScreenBrightness: h.hasScreenBrightness },
    envConfig: {},
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      swipeBrightnessGesture: h.swipeSetting,
      screenBrightness: h.screenBrightness,
      autoScreenBrightness: h.autoScreenBrightness,
    },
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => ({ scrolled: h.scrolled }) }),
}));
vi.mock('@/store/deviceStore', () => {
  const useDeviceControlStore = () => ({
    getScreenBrightness: h.getScreenBrightness,
    setScreenBrightness: h.setScreenBrightness,
  });
  useDeviceControlStore.getState = () => ({ lastScreenBrightness: h.lastScreenBrightness });
  return { useDeviceControlStore };
});
vi.mock('@/helpers/settings', () => ({ saveSysSettings: h.saveSysSettings }));

import { useBrightnessGesture } from '@/app/reader/hooks/useBrightnessGesture';

type Api = ReturnType<typeof useBrightnessGesture>;
type TouchLike = { clientX: number; clientY: number; screenX: number; screenY: number };
type FakeTouchEvent = Event & { touches: TouchLike[]; changedTouches: TouchLike[] };
type SelectableDoc = { getSelection: () => { isCollapsed: boolean } | null };

const setSelection = (d: Document, isCollapsed: boolean) => {
  (d as unknown as SelectableDoc).getSelection = () => ({ isCollapsed });
};

const makeDoc = () => {
  const d = document.implementation.createHTMLDocument('t');
  Object.defineProperty(d.documentElement, 'clientWidth', { value: 1000, configurable: true });
  Object.defineProperty(d.documentElement, 'clientHeight', { value: 1000, configurable: true });
  setSelection(d, true);
  return d;
};

const fireTouch = (target: EventTarget, type: string, x: number, y: number) => {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as FakeTouchEvent;
  const touch = { clientX: x, clientY: y, screenX: x, screenY: y };
  ev.touches = [touch];
  ev.changedTouches = [touch];
  const preventDefault = vi.spyOn(ev, 'preventDefault');
  const stopImmediatePropagation = vi.spyOn(ev, 'stopImmediatePropagation');
  act(() => {
    target.dispatchEvent(ev);
  });
  return { preventDefault, stopImmediatePropagation };
};

const setup = () => {
  let api: Api = null as unknown as Api;
  function Wrapper() {
    api = useBrightnessGesture('book-1');
    return null;
  }
  const utils = render(<Wrapper />);
  const doc = makeDoc();
  act(() => api.registerBrightnessListeners(doc as unknown as Document));
  // a descendant target so capture-phase doc listeners fire before bubble ones
  const target = doc.createElement('div');
  doc.body.appendChild(target);
  // stand-in for foliate-js's own bubble-phase paginator listener
  const paginator = vi.fn();
  doc.addEventListener('touchmove', paginator);
  return { getApi: () => api, doc, target, paginator, rerender: () => utils.rerender(<Wrapper />) };
};

describe('useBrightnessGesture (listener-level)', () => {
  beforeEach(() => {
    h.hasScreenBrightness = true;
    h.swipeSetting = true;
    h.scrolled = false;
    h.screenBrightness = -1;
    h.autoScreenBrightness = false;
    h.lastScreenBrightness = null;
    h.setScreenBrightness.mockReset();
    h.saveSysSettings.mockReset();
    h.getScreenBrightness.mockReset().mockResolvedValue(0.5);
  });
  afterEach(() => cleanup());

  it('activates on a left-edge upward flick and suppresses the paginator (capture phase)', () => {
    const { target, paginator } = setup();
    fireTouch(target, 'touchstart', 10, 500); // x=10 → inside left 10%
    const { preventDefault, stopImmediatePropagation } = fireTouch(target, 'touchmove', 10, 470); // dy=-30
    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(paginator).not.toHaveBeenCalled(); // suppressed → never reaches bubble phase
  });

  it('does not activate for a horizontal-dominant swipe; paginator still runs', () => {
    const { target, paginator } = setup();
    fireTouch(target, 'touchstart', 10, 500);
    const { stopImmediatePropagation } = fireTouch(target, 'touchmove', 60, 510); // dx=50, dy=10
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalled();
  });

  it('does not arm outside the left strip', () => {
    const { target, paginator } = setup();
    fireTouch(target, 'touchstart', 500, 500); // center
    const { stopImmediatePropagation } = fireTouch(target, 'touchmove', 500, 460);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalled();
  });

  it('does not hijack an in-progress text selection', () => {
    const { doc, target, paginator } = setup();
    setSelection(doc, false);
    fireTouch(target, 'touchstart', 10, 500);
    const { stopImmediatePropagation } = fireTouch(target, 'touchmove', 10, 470);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalled();
  });

  it('reserves the strip in scrolled mode: preventDefault before activation, no stopImmediatePropagation', () => {
    h.scrolled = true;
    const { target } = setup();
    fireTouch(target, 'touchstart', 10, 500);
    const { preventDefault, stopImmediatePropagation } = fireTouch(target, 'touchmove', 10, 495); // dy=-5, below 18px
    expect(preventDefault).toHaveBeenCalled(); // scroll reserved
    expect(stopImmediatePropagation).not.toHaveBeenCalled(); // not yet active
  });

  it('persists brightness on release in manual mode', () => {
    const { target } = setup();
    fireTouch(target, 'touchstart', 10, 800);
    fireTouch(target, 'touchmove', 10, 300); // big upward drag → brighter
    fireTouch(target, 'touchend', 10, 300);
    expect(h.setScreenBrightness).toHaveBeenCalled();
    const last = h.setScreenBrightness.mock.calls.at(-1)![0];
    expect(last).toBeGreaterThan(0.5);
    expect(h.saveSysSettings).toHaveBeenCalledWith({}, 'screenBrightness', expect.any(Number));
  });

  it('keeps system brightness on: applies the swipe without persisting it', () => {
    h.autoScreenBrightness = true;
    const { target } = setup();
    fireTouch(target, 'touchstart', 10, 800);
    fireTouch(target, 'touchmove', 10, 300);
    fireTouch(target, 'touchend', 10, 300);
    expect(h.setScreenBrightness.mock.calls.at(-1)![0]).toBeGreaterThan(0.5);
    expect(h.saveSysSettings).not.toHaveBeenCalled();
  });

  it('seeds from the device when system brightness is on, ignoring the stale saved value', async () => {
    h.autoScreenBrightness = true;
    h.screenBrightness = 100;
    h.getScreenBrightness.mockResolvedValue(0.2);
    const { target } = setup();
    await act(async () => {});
    fireTouch(target, 'touchstart', 10, 500);
    fireTouch(target, 'touchmove', 10, 400);
    fireTouch(target, 'touchend', 10, 400);
    expect(h.setScreenBrightness.mock.calls.at(-1)![0]).toBeLessThan(0.5);
  });

  it('starts from the brightness the slider last applied, not the mount-time seed', async () => {
    h.autoScreenBrightness = true;
    h.getScreenBrightness.mockResolvedValue(0.9);
    const { target } = setup();
    await act(async () => {});
    h.lastScreenBrightness = 0.1; // slider dragged down, nothing persisted
    fireTouch(target, 'touchstart', 10, 500);
    fireTouch(target, 'touchmove', 10, 400);
    fireTouch(target, 'touchend', 10, 400);
    expect(h.setScreenBrightness.mock.calls.at(-1)![0]).toBeLessThan(0.5);
  });

  it('is inert when the setting is disabled', () => {
    h.swipeSetting = false;
    const { target, paginator, rerender } = setup();
    rerender();
    fireTouch(target, 'touchstart', 10, 500);
    const { stopImmediatePropagation } = fireTouch(target, 'touchmove', 10, 460);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalled();
    expect(h.setScreenBrightness).not.toHaveBeenCalled();
  });

  it('is inert when the platform lacks screen brightness control', () => {
    h.hasScreenBrightness = false;
    const { target, paginator, rerender } = setup();
    rerender();
    fireTouch(target, 'touchstart', 10, 500);
    const { stopImmediatePropagation } = fireTouch(target, 'touchmove', 10, 460);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalled();
  });
});
