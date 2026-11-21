// @vitest-environment happy-dom
import React, { StrictMode, useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every Settings page renders inside the dialog's one scroll viewport, so its
 * offset belongs to whichever page is on screen. A sub-page is usually shorter
 * than the panel it covers, and laying it out clamps the panel's offset into
 * the sub-page's range: Back used to land at the top, or at the sub-page's
 * own offset (#7744).
 */

const panels = vi.hoisted(() => ({
  font: (): React.ReactNode => null,
  layout: (): React.ReactNode => null,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isAndroidApp: false, isMobile: false } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));
vi.mock('@/services/environment', () => ({ getCommandPaletteShortcut: () => '' }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setFontPanelView: vi.fn(),
    setSettingsDialogOpen: vi.fn(),
    setActiveSettingsItemId: vi.fn(),
    setRequestedPanel: vi.fn(),
  }),
}));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));
vi.mock('@/components/Dialog', () => ({
  default: ({ children, header }: { children: React.ReactNode; header: React.ReactNode }) => (
    <>
      {header}
      <div
        data-testid='viewport'
        data-overlayscrollbars-contents=''
        data-overlayscrollbars-viewport=''
      >
        {children}
      </div>
    </>
  ),
}));
vi.mock('@/components/settings/FontPanel', () => ({ default: () => panels.font() }));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => panels.layout() }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/TTSPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/AIPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));

const { default: SubPageHeader } = await import('@/components/settings/SubPageHeader');
const { useSettingsSubPageBack } = await import('@/components/settings/settingsSubPageBack');
const { default: SettingsDialog, resetSettingsScrollPosition } = await import(
  '@/components/settings/SettingsDialog'
);

const CLIENT_HEIGHT = 500;

/** A page of the given height in px; the fake viewport sums them. */
const Block = ({ h, children }: { h: number; children?: React.ReactNode }) => (
  <div data-h={h}>{children}</div>
);

/**
 * Emulates the browser's layout clamp: the viewport's offset can never exceed
 * what the content currently on screen can take.
 */
const fakeViewport = () => {
  const viewport = screen.getByTestId('viewport');
  let raw = 0;
  const scrollHeight = () =>
    [...viewport.querySelectorAll<HTMLElement>('[data-h]')].reduce(
      (sum, el) => sum + Number(el.dataset['h']),
      0,
    );
  Object.defineProperties(viewport, {
    clientHeight: { get: () => CLIENT_HEIGHT },
    scrollHeight: { get: scrollHeight },
    scrollTop: {
      get: () => {
        raw = Math.max(0, Math.min(raw, scrollHeight() - CLIENT_HEIGHT));
        return raw;
      },
      set: (value: number) => {
        raw = value;
      },
    },
  });
  return viewport;
};

const userScroll = (viewport: HTMLElement, top: number) => {
  viewport.scrollTop = top;
  fireEvent.scroll(viewport);
};

// The Settings header's back arrow: the mocked Dialog has no Escape handling.
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));

/** Integrations → Send to Readest: a long panel and a one-screen form. */
const ShortSubPagePanel = () => {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <Block h={520}>
        <SubPageHeader
          parentLabel='Integrations'
          currentLabel='Send to Readest'
          onBack={() => setOpen(false)}
        />
      </Block>
    );
  return (
    <Block h={1341}>
      <button onClick={() => setOpen(true)}>Send to Readest</button>
    </Block>
  );
};

/** TTS → Voice Library: a sub-page longer than its panel. */
const LongSubPagePanel = () => {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <Block h={3000}>
        <SubPageHeader
          parentLabel='TTS'
          currentLabel='Voice Library'
          onBack={() => setOpen(false)}
        />
      </Block>
    );
  return (
    <Block h={1200}>
      <button onClick={() => setOpen(true)}>Voice Library</button>
    </Block>
  );
};

/** Custom TTS Services: the list swaps itself for a service's editor. */
const ServiceEditor = ({ onBack }: { onBack: () => void }) => (
  <Block h={600}>
    <SubPageHeader parentLabel='Custom TTS Services' currentLabel='My service' onBack={onBack} />
  </Block>
);
const ServiceList = ({ onBack, onEdit }: { onBack: () => void; onEdit: () => void }) => (
  <Block h={1500}>
    <SubPageHeader parentLabel='TTS' currentLabel='Custom TTS Services' onBack={onBack} />
    <button onClick={onEdit}>My service</button>
  </Block>
);
const SwapPanel = () => {
  const [page, setPage] = useState<'panel' | 'list' | 'editor'>('panel');
  if (page === 'editor') return <ServiceEditor onBack={() => setPage('list')} />;
  if (page === 'list')
    return <ServiceList onBack={() => setPage('panel')} onEdit={() => setPage('editor')} />;
  return (
    <Block h={1200}>
      <button onClick={() => setPage('list')}>Custom TTS Services</button>
    </Block>
  );
};

/** A panel whose rows arrive a few frames after it mounts. */
const LoadingRows = () => {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);
  return <Block h={loaded ? 1400 : 100} />;
};
const LoadingPanel = () => {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <Block h={300}>
        <SubPageHeader
          parentLabel='Font'
          currentLabel='Manage Fonts'
          onBack={() => setOpen(false)}
        />
      </Block>
    );
  return (
    <div>
      <button onClick={() => setOpen(true)}>Manage Fonts</button>
      <LoadingRows />
    </div>
  );
};

/**
 * Audiobookshelf: the server list keeps its header above a server's detail,
 * and both the panel and the list load their rows late.
 */
const ServerDetail = ({ onBack }: { onBack: () => void }) => {
  useSettingsSubPageBack(onBack);
  return <Block h={200}>Server detail</Block>;
};
const ServerList = ({ onBack }: { onBack: () => void }) => {
  const [detail, setDetail] = useState(false);
  return (
    <div>
      <SubPageHeader parentLabel='Integrations' currentLabel='Audiobookshelf' onBack={onBack} />
      {detail ? (
        <ServerDetail onBack={() => setDetail(false)} />
      ) : (
        <>
          <button onClick={() => setDetail(true)}>My server</button>
          <LoadingRows />
        </>
      )}
    </div>
  );
};
const KeptHeaderLoadingPanel = () => {
  const [open, setOpen] = useState(false);
  if (open) return <ServerList onBack={() => setOpen(false)} />;
  return (
    <div>
      <button onClick={() => setOpen(true)}>Audiobookshelf</button>
      <LoadingRows />
    </div>
  );
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  panels.font = () => null;
  panels.layout = () => null;
});

afterEach(() => {
  cleanup();
  resetSettingsScrollPosition();
  vi.unstubAllGlobals();
});

describe('Settings sub-page scroll position', () => {
  it('restores the panel offset after a short sub-page clamped it', async () => {
    panels.font = () => <ShortSubPagePanel />;
    render(<SettingsDialog bookKey='' />);
    const viewport = fakeViewport();
    userScroll(viewport, 841);

    fireEvent.click(screen.getByText('Send to Readest'));
    expect(viewport.scrollTop).toBe(0);

    back();
    expect(screen.getByRole('button', { name: 'Send to Readest' })).toBeTruthy();
    await waitFor(() => expect(viewport.scrollTop).toBe(841));
  });

  it("restores the panel offset, not the sub-page's own", async () => {
    panels.font = () => <LongSubPagePanel />;
    render(<SettingsDialog bookKey='' />);
    const viewport = fakeViewport();
    userScroll(viewport, 200);

    fireEvent.click(screen.getByText('Voice Library'));
    expect(viewport.scrollTop).toBe(0);
    userScroll(viewport, 40);

    back();
    await waitFor(() => expect(viewport.scrollTop).toBe(200));
  });

  it.each([
    ['', false],
    [' under StrictMode', true],
  ])('restores each level when a sub-page swaps itself for a deeper one%s', async (_, strict) => {
    panels.font = () => <SwapPanel />;
    render(
      strict ? (
        <StrictMode>
          <SettingsDialog bookKey='' />
        </StrictMode>
      ) : (
        <SettingsDialog bookKey='' />
      ),
    );
    const viewport = fakeViewport();
    userScroll(viewport, 300);

    fireEvent.click(screen.getByText('Custom TTS Services'));
    expect(viewport.scrollTop).toBe(0);
    userScroll(viewport, 900);

    fireEvent.click(screen.getByRole('button', { name: 'My service' }));
    expect(viewport.scrollTop).toBe(0);
    userScroll(viewport, 50);

    back();
    await waitFor(() => expect(viewport.scrollTop).toBe(900));
    expect(screen.getByRole('button', { name: 'My service' })).toBeTruthy();

    back();
    await waitFor(() => expect(viewport.scrollTop).toBe(300));
    expect(screen.getByRole('button', { name: 'Custom TTS Services' })).toBeTruthy();
  });

  it('waits for the panel to grow tall enough to take its offset', async () => {
    panels.font = () => <LoadingPanel />;
    render(<SettingsDialog bookKey='' />);
    const viewport = fakeViewport();
    await waitFor(() => expect(viewport.scrollHeight).toBe(1400));
    userScroll(viewport, 700);

    fireEvent.click(screen.getByText('Manage Fonts'));
    expect(viewport.scrollTop).toBe(0);
    back();
    expect(viewport.scrollHeight).toBe(100);
    await waitFor(() => expect(viewport.scrollHeight).toBe(1400));
    await waitFor(() => expect(viewport.scrollTop).toBe(700));
  });

  it('lets the latest Back win while both pages are still loading', async () => {
    panels.font = () => <KeptHeaderLoadingPanel />;
    render(<SettingsDialog bookKey='' />);
    const viewport = fakeViewport();
    await waitFor(() => expect(viewport.scrollHeight).toBe(1400));
    userScroll(viewport, 900);

    fireEvent.click(screen.getByText('Audiobookshelf'));
    await waitFor(() => expect(viewport.scrollHeight).toBe(1400));
    userScroll(viewport, 300);
    fireEvent.click(screen.getByText('My server'));

    // Back twice, as two separate key presses, before either page's rows load.
    back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    back();
    expect(screen.getByRole('button', { name: 'Audiobookshelf' })).toBeTruthy();
    await waitFor(() => expect(viewport.scrollHeight).toBe(1400));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(viewport.scrollTop).toBe(900);
  });

  it("doesn't carry a sub-page's way back into another tab", async () => {
    panels.font = () => <ShortSubPagePanel />;
    panels.layout = () => <Block h={2000}>Layout rows</Block>;
    render(<SettingsDialog bookKey='' />);
    const viewport = fakeViewport();
    userScroll(viewport, 841);
    fireEvent.click(screen.getByText('Send to Readest'));

    fireEvent.click(screen.getByTitle('Layout'));
    expect(screen.getByText('Layout rows')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(viewport.scrollTop).toBe(0);
  });
});
