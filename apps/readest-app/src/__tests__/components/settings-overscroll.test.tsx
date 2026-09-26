import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const env = vi.hoisted(() => ({ isAndroidApp: true, isMobile: true }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: env }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));
vi.mock('@/services/environment', () => ({ getCommandPaletteShortcut: () => '' }));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setFontPanelView: vi.fn(),
    setSettingsDialogOpen: vi.fn(),
    setActiveSettingsItemId: vi.fn(),
    setRequestedPanel: vi.fn(),
  }),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <>
      {header}
      <div data-testid='viewport' data-overlayscrollbars-viewport='' style={{ overflowY: 'auto' }}>
        {children}
      </div>
    </>
  ),
}));
vi.mock('@/components/settings/FontPanel', () => ({
  default: () => (
    <div data-testid='content'>
      Settings <input data-testid='input' />
    </div>
  ),
}));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/TTSPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/AIPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));

const { default: SettingsDialog } = await import('@/components/settings/SettingsDialog');

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  env.isAndroidApp = true;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-eink');
});

const setup = (scrollTop = 0) => {
  render(<SettingsDialog bookKey='' />);
  const viewport = screen.getByTestId('viewport');
  Object.defineProperties(viewport, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
    scrollTop: { value: scrollTop, writable: true },
  });
  return {
    viewport,
    content: screen.getByTestId('content'),
    panel: screen.getByTestId('content').parentElement!,
  };
};
const touch = (element: HTMLElement, type: string, x: number, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: [{ clientX: x, clientY: y }] });
  fireEvent(element, event);
  return event;
};

describe('Android Settings overscroll', () => {
  it.each([0, 600])('rubber-bands at scrollTop %s and returns on release', (scrollTop) => {
    const { panel, content, viewport } = setup(scrollTop);
    touch(content, 'touchstart', 100, 300);
    const event = touch(content, 'touchmove', 100, scrollTop === 0 ? 400 : 200);
    expect(event.defaultPrevented).toBe(true);
    const offset = Number(panel.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1]);
    expect(Math.abs(offset)).toBeGreaterThan(0);
    expect(Math.abs(offset)).toBeLessThan(100);
    expect(Math.sign(offset)).toBe(scrollTop === 0 ? 1 : -1);
    expect(viewport.scrollTop).toBe(scrollTop);
    touch(content, 'touchend', 100, 400);
    expect(panel.style.transform).toBe('');
  });

  it('returns when the system cancels the gesture', () => {
    const { panel, content } = setup();
    touch(content, 'touchstart', 100, 300);
    touch(content, 'touchmove', 100, 400);
    expect(panel.style.transform).not.toBe('');
    touch(content, 'touchcancel', 100, 400);
    expect(panel.style.transform).toBe('');
  });

  it.each([
    'middle',
    'inward',
    'sideways',
    'input',
    'ios',
    'eink',
  ])('preserves native gestures: %s', (kind) => {
    if (kind === 'ios') env.isAndroidApp = false;
    if (kind === 'eink') document.documentElement.dataset['eink'] = 'true';
    const { panel, content } = setup(kind === 'middle' ? 200 : 0);
    const target = kind === 'input' ? screen.getByTestId('input') : content;
    touch(target, 'touchstart', 100, 300);
    const event = touch(
      target,
      'touchmove',
      kind === 'sideways' ? 300 : 100,
      kind === 'inward' ? 200 : 400,
    );
    expect(event.defaultPrevented).toBe(false);
    expect(panel.style.transform).toBe('');
  });
});

describe('Settings tab scrolling', () => {
  it.each([true, false])('starts a newly selected tab at the top (Android: %s)', (android) => {
    env.isAndroidApp = android;
    const { viewport } = setup(200);
    fireEvent.click(screen.getByTitle('Layout'));
    expect(viewport.scrollTop).toBe(0);
    viewport.scrollTop = 300;
    fireEvent.click(screen.getByTitle('Font'));
    expect(viewport.scrollTop).toBe(0);
  });
});
