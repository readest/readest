import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * iOS shows no status bar on a landscape iPhone, so useTheme marks the system
 * UI always hidden there. The rule depends on the window height, so folding
 * iPhone Duo between displays (landscape both times, resize only) must
 * re-evaluate it (#6307). That is iPhone Duo only: every other device keeps the
 * base rule (any landscape, on orientation change only).
 */

const h = vi.hoisted(() => ({
  setSystemUIVisibility: vi.fn(() => Promise.resolve({ success: true })),
  onUpdateInsets: vi.fn(),
  appService: { isMobileApp: true, isIOSApp: true, isAndroidApp: false },
  settings: { settings: {} },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => h.settings }));
vi.mock('@/hooks/useSafeAreaInsets', () => ({
  useSafeAreaInsets: () => ({ onUpdateInsets: h.onUpdateInsets }),
}));
vi.mock('@/utils/bridge', () => ({
  getStatusBarHeight: vi.fn(),
  setSystemUIVisibility: h.setSystemUIVisibility,
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'ios',
}));

import { useThemeStore } from '@/store/themeStore';
import { useTheme } from '@/hooks/useTheme';

const orientation = Object.assign(new EventTarget(), { type: 'landscape-primary' });
const setHeight = (height: number) =>
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
const flush = () => act(async () => {});

beforeEach(() => {
  Object.defineProperty(window.screen, 'orientation', { value: orientation, configurable: true });
  orientation.type = 'landscape-primary';
  useThemeStore.setState({
    systemUIAlwaysHidden: false,
    systemUIVisible: true,
    isIPhoneDuo: false,
  });
  h.setSystemUIVisibility.mockClear();
  h.onUpdateInsets.mockClear();
});

afterEach(cleanup);

describe('useTheme landscape status-bar rule on iPhone Duo', () => {
  beforeEach(() => useThemeStore.setState({ isIPhoneDuo: true }));

  it('applies on mount for a compact landscape window', () => {
    setHeight(402);
    const { unmount } = renderHook(() => useTheme());
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(true);
    expect(h.setSystemUIVisibility).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: false }),
    );
    unmount();
  });

  it('re-evaluates on resize when both displays are landscape, and only when it changed', () => {
    setHeight(466); // Duo cover display
    const { unmount } = renderHook(() => useTheme());
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(true);
    h.setSystemUIVisibility.mockClear();

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(h.setSystemUIVisibility).not.toHaveBeenCalled();

    setHeight(669); // unfolded to the inner display
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(false);
    expect(h.setSystemUIVisibility).toHaveBeenCalledTimes(1);
    expect(h.setSystemUIVisibility).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true }),
    );
    unmount();
  });

  it('evaluates once the native bridge reports the Duo, after mount', () => {
    useThemeStore.setState({ isIPhoneDuo: false });
    setHeight(466);
    const { unmount } = renderHook(() => useTheme());
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(false);

    act(() => useThemeStore.setState({ isIPhoneDuo: true }));
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(true);
    unmount();
  });

  it('re-reads the insets after a visibility change', async () => {
    setHeight(669);
    const { unmount } = renderHook(() => useTheme());
    await flush();
    expect(h.onUpdateInsets).toHaveBeenCalled();
    unmount();
  });
});

describe('useTheme landscape status-bar rule off iPhone Duo (base behaviour)', () => {
  it('does nothing on mount, even for a compact landscape window', () => {
    setHeight(402);
    const { unmount } = renderHook(() => useTheme());
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(false);
    expect(h.setSystemUIVisibility).not.toHaveBeenCalledWith(
      expect.objectContaining({ visible: false }),
    );
    unmount();
  });

  it('does nothing on resize', () => {
    setHeight(402);
    const { unmount } = renderHook(() => useTheme());
    h.setSystemUIVisibility.mockClear();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(false);
    expect(h.setSystemUIVisibility).not.toHaveBeenCalled();
    unmount();
  });

  it('treats any landscape orientation change as status-bar-hidden, whatever the height', () => {
    setHeight(680); // iPad-sized 1024x680 window
    const { unmount } = renderHook(() => useTheme());
    act(() => {
      orientation.dispatchEvent(new Event('change'));
    });
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(true);
    expect(h.setSystemUIVisibility).toHaveBeenCalled();

    orientation.type = 'portrait-primary';
    act(() => {
      orientation.dispatchEvent(new Event('change'));
    });
    expect(useThemeStore.getState().systemUIAlwaysHidden).toBe(false);
    unmount();
  });

  it('computes the rotation visibility request from the render value, as base did', () => {
    setHeight(402);
    const { unmount } = renderHook(() => useTheme());
    h.setSystemUIVisibility.mockClear();
    act(() => {
      orientation.dispatchEvent(new Event('change'));
    });
    // Base read systemUIAlwaysHidden from the render closure, so the request
    // made in the same tick as the flag flips still asks for a visible bar.
    expect(h.setSystemUIVisibility).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true }),
    );
    unmount();
  });

  it('does not re-read the insets after a visibility change', async () => {
    setHeight(669);
    const { unmount } = renderHook(() => useTheme());
    await flush();
    expect(h.setSystemUIVisibility).toHaveBeenCalled();
    expect(h.onUpdateInsets).not.toHaveBeenCalled();
    unmount();
  });
});
