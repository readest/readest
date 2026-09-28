import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';

const env = vi.hoisted(() => ({ isAndroidApp: true, isMobile: true }));
// OverlayScrollbars initializes with `defer`, so on open the contents element
// exists but is not yet the scrolling viewport.
const scroller = vi.hoisted(() => ({ initialized: true }));
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
      <div
        data-testid='viewport'
        data-overlayscrollbars-contents=''
        data-overlayscrollbars-viewport={scroller.initialized ? '' : undefined}
        style={{ overflowY: 'auto' }}
      >
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

const { default: SettingsDialog, resetSettingsScrollPosition } = await import(
  '@/components/settings/SettingsDialog'
);

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  env.isAndroidApp = true;
  scroller.initialized = true;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  resetSettingsScrollPosition();
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
  const scrollAndClose = (top: number) => {
    const { viewport } = setup();
    viewport.scrollTop = top;
    cleanup();
  };

  it('restores the scroll position when reopened during the same app run', () => {
    scrollAndClose(240);
    render(<SettingsDialog bookKey='' />);
    expect(screen.getByTestId('viewport').scrollTop).toBe(240);
  });

  it('hides the panel until the deferred scroller can take the saved position', async () => {
    scrollAndClose(240);
    scroller.initialized = false;
    render(<SettingsDialog bookKey='' />);
    const viewport = screen.getByTestId('viewport');
    const panel = screen.getByTestId('content').parentElement!;
    expect(panel.style.visibility).toBe('hidden');

    viewport.setAttribute('data-overlayscrollbars-viewport', '');
    await waitFor(() => expect(panel.style.visibility).toBe(''));
    expect(viewport.scrollTop).toBe(240);
  });

  it('keeps the saved position when closed before the scroller initializes', () => {
    scrollAndClose(240);
    scroller.initialized = false;
    render(<SettingsDialog bookKey='' />);
    cleanup();

    scroller.initialized = true;
    render(<SettingsDialog bookKey='' />);
    expect(screen.getByTestId('viewport').scrollTop).toBe(240);
  });

  it('restores under StrictMode double-invoked effects', async () => {
    scrollAndClose(240);
    scroller.initialized = false;
    render(
      <StrictMode>
        <SettingsDialog bookKey='' />
      </StrictMode>,
    );
    const viewport = screen.getByTestId('viewport');
    viewport.setAttribute('data-overlayscrollbars-viewport', '');
    await waitFor(() => expect(viewport.scrollTop).toBe(240));
  });

  it('does not restore a position saved on another panel', () => {
    scrollAndClose(240);
    localStorage.setItem('lastConfigPanel', 'Layout');
    render(<SettingsDialog bookKey='' />);
    expect(screen.getByTestId('viewport').scrollTop).toBe(0);
  });

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
