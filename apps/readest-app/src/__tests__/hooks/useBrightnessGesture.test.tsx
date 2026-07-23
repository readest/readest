import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  hasScreenBrightness: true,
  swipeSetting: true,
  scrolled: false,
  screenBrightness: -1,
  setScreenBrightness: vi.fn(),
  getScreenBrightness: vi.fn(),
  saveSysSettings: vi.fn(),
  renderer: {
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { hasScreenBrightness: h.hasScreenBrightness },
    envConfig: {},
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { swipeBrightnessGesture: h.swipeSetting, screenBrightness: h.screenBrightness },
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ renderer: h.renderer }),
    getViewSettings: () => ({ scrolled: h.scrolled }),
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    getScreenBrightness: h.getScreenBrightness,
    setScreenBrightness: h.setScreenBrightness,
  }),
}));
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

const dispatchTouch = (
  target: EventTarget,
  type: string,
  touches: TouchLike[],
  changedTouches = touches,
) => {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as FakeTouchEvent;
  ev.touches = touches;
  ev.changedTouches = changedTouches;
  const preventDefault = vi.spyOn(ev, 'preventDefault');
  const stopImmediatePropagation = vi.spyOn(ev, 'stopImmediatePropagation');
  act(() => {
    target.dispatchEvent(ev);
  });
  return { preventDefault, stopImmediatePropagation };
};

const point = (x: number, y: number): TouchLike => ({
  clientX: x,
  clientY: y,
  screenX: x,
  screenY: y,
});

const fireTouch = (target: EventTarget, type: string, x: number, y: number) => {
  const touch = point(x, y);
  const activeTouches = type === 'touchend' || type === 'touchcancel' ? [] : [touch];
  return dispatchTouch(target, type, activeTouches, [touch]);
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
    h.setScreenBrightness.mockReset();
    h.saveSysSettings.mockReset();
    h.renderer.setAttribute.mockReset();
    h.renderer.removeAttribute.mockReset();
    h.getScreenBrightness.mockReset().mockResolvedValue(0.5);
  });
  afterEach(() => cleanup());

  it('publishes the reserved left inset to the page-turn arena while enabled', () => {
    setup();

    expect(h.renderer.setAttribute).toHaveBeenCalledWith('turn-gesture-left-inset', '0.1');
  });

  it('removes the reserved left inset when the gesture is disabled', () => {
    h.swipeSetting = false;
    setup();

    expect(h.renderer.removeAttribute).toHaveBeenCalledWith('turn-gesture-left-inset');
  });

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

  it('cannot take ownership after a horizontal page-turn trajectory wins', () => {
    const { target, paginator } = setup();
    fireTouch(target, 'touchstart', 10, 500);
    fireTouch(target, 'touchmove', 40, 500); // horizontal > 18px permanently disarms
    const { stopImmediatePropagation } = fireTouch(target, 'touchmove', 40, 450);

    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalledTimes(2);
    expect(h.setScreenBrightness).not.toHaveBeenCalled();
  });

  it('permanently yields when a second finger joins in the brightness strip', () => {
    const { target, paginator } = setup();
    fireTouch(target, 'touchstart', 10, 500);
    dispatchTouch(target, 'touchstart', [point(10, 500), point(30, 500)], [point(30, 500)]);
    const { stopImmediatePropagation } = dispatchTouch(target, 'touchmove', [
      point(10, 450),
      point(30, 450),
    ]);

    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(paginator).toHaveBeenCalled();
    expect(h.setScreenBrightness).not.toHaveBeenCalled();
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

  it('persists brightness and disables auto-brightness on release', () => {
    const { target } = setup();
    fireTouch(target, 'touchstart', 10, 800);
    fireTouch(target, 'touchmove', 10, 300); // big upward drag → brighter
    fireTouch(target, 'touchend', 10, 300);
    expect(h.setScreenBrightness).toHaveBeenCalled();
    const last = h.setScreenBrightness.mock.calls.at(-1)![0];
    expect(last).toBeGreaterThan(0.5);
    expect(h.saveSysSettings).toHaveBeenCalledWith({}, 'screenBrightness', expect.any(Number));
    expect(h.saveSysSettings).toHaveBeenCalledWith({}, 'autoScreenBrightness', false);
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
