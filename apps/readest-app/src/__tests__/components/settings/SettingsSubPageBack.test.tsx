// @vitest-environment happy-dom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Escape, Android Back and the Settings header's back arrow leave one settings
 * level at a time. Settings nests its pages inside a single dialog — Font →
 * Manage Fonts, TTS → Voice Library, Integrations → Data Flow — and the dialog
 * used to close outright from any depth, dropping the reader back into the book.
 */

const env = vi.hoisted(() => ({ isAndroidApp: false, isMobile: false }));
const settings = vi.hoisted(() => ({ setSettingsDialogOpen: vi.fn() }));
const fontPanel = vi.hoisted(() => ({ render: (): React.ReactNode => null }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: env }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/store/deviceStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/deviceStore')>()),
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setFontPanelView: vi.fn(),
    setSettingsDialogOpen: settings.setSettingsDialogOpen,
    setActiveSettingsItemId: vi.fn(),
    setRequestedPanel: vi.fn(),
  }),
}));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));
vi.mock('@/components/settings/FontPanel', () => ({ default: () => fontPanel.render() }));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/TTSPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/AIPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));

const { default: Dialog } = await import('@/components/Dialog');
const { default: SubPageHeader } = await import('@/components/settings/SubPageHeader');
const { default: SettingsDialog } = await import('@/components/settings/SettingsDialog');
const { useSettingsSubPageBack } = await import('@/components/settings/settingsSubPageBack');
const { eventDispatcher } = await import('@/utils/event');

/** Font → Voice Library → Custom service, as TTS nests its pages. */
const NestedPanel = () => {
  const [depth, setDepth] = useState(0);
  if (depth === 0) return <button onClick={() => setDepth(1)}>Voice Library</button>;
  if (depth === 1)
    return (
      <div>
        <SubPageHeader parentLabel='TTS' currentLabel='Voice Library' onBack={() => setDepth(0)} />
        <button onClick={() => setDepth(2)}>Open service editor</button>
      </div>
    );
  return (
    <SubPageHeader
      parentLabel='Voice Library'
      currentLabel='Custom service'
      onBack={() => setDepth(1)}
    />
  );
};

/**
 * A list page whose header stays mounted under a detail level, as ABSForm keeps
 * its SubPageHeader above a server's detail: two levels registered at once.
 */
const ServerDetail = ({ onBack }: { onBack: () => void }) => {
  useSettingsSubPageBack(onBack);
  return <p>Server detail</p>;
};
const KeptHeaderPanel = () => {
  const [page, setPage] = useState<'panel' | 'list' | 'detail'>('panel');
  if (page === 'panel') return <button onClick={() => setPage('list')}>Audiobookshelf</button>;
  return (
    <div>
      <SubPageHeader
        parentLabel='Integrations'
        currentLabel='Servers'
        onBack={() => setPage('panel')}
      />
      {page === 'detail' ? (
        <ServerDetail onBack={() => setPage('list')} />
      ) : (
        <button onClick={() => setPage('detail')}>My server</button>
      )}
    </div>
  );
};

const openNested = () => {
  render(<SettingsDialog bookKey='' />);
  fireEvent.click(screen.getByText('Voice Library'));
  fireEvent.click(screen.getByText('Open service editor'));
  expect(screen.getByText('Custom service')).toBeTruthy();
};

const expectSteppedBackThroughEveryLevel = (back: () => void) => {
  back();
  expect(screen.queryByText('Custom service')).toBeNull();
  expect(screen.getByText('Open service editor')).toBeTruthy();
  expect(settings.setSettingsDialogOpen).not.toHaveBeenCalled();

  back();
  expect(screen.queryByText('Open service editor')).toBeNull();
  expect(screen.getByText('Voice Library')).toBeTruthy();
  expect(settings.setSettingsDialogOpen).not.toHaveBeenCalled();

  back();
  expect(settings.setSettingsDialogOpen).toHaveBeenCalledTimes(1);
  expect(settings.setSettingsDialogOpen).toHaveBeenCalledWith(false);
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  env.isAndroidApp = false;
  settings.setSettingsDialogOpen.mockClear();
  fontPanel.render = () => <NestedPanel />;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings back stack', () => {
  it('steps back one level per Escape and closes only from the panel', () => {
    openNested();
    expectSteppedBackThroughEveryLevel(() => fireEvent.keyDown(window, { key: 'Escape' }));
  });

  it('steps back one level per Android Back and closes only from the panel', () => {
    env.isAndroidApp = true;
    openNested();
    expectSteppedBackThroughEveryLevel(() => {
      let consumed = false;
      act(() => {
        consumed = eventDispatcher.dispatchSync('native-key-down', { keyName: 'Back' });
      });
      expect(consumed).toBe(true);
    });
  });

  it("steps back one level per tap on the header's back arrow", () => {
    openNested();
    expectSteppedBackThroughEveryLevel(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Back' })),
    );
  });

  it('steps out of the deeper of two mounted levels first', () => {
    fontPanel.render = () => <KeptHeaderPanel />;
    render(<SettingsDialog bookKey='' />);
    fireEvent.click(screen.getByText('Audiobookshelf'));
    fireEvent.click(screen.getByText('My server'));
    expect(screen.getByText('Server detail')).toBeTruthy();
    const pressEscape = () => fireEvent.keyDown(window, { key: 'Escape' });

    pressEscape();
    expect(screen.queryByText('Server detail')).toBeNull();
    expect(screen.getByText('My server')).toBeTruthy();

    // The detail's handler is gone; the list header underneath answers next.
    pressEscape();
    expect(screen.queryByText('My server')).toBeNull();
    expect(screen.getByText('Audiobookshelf')).toBeTruthy();
    expect(settings.setSettingsDialogOpen).not.toHaveBeenCalled();

    pressEscape();
    expect(settings.setSettingsDialogOpen).toHaveBeenCalledWith(false);
  });

  it('closes straight away when no sub-page is open', () => {
    fontPanel.render = () => <p>Font panel</p>;
    render(<SettingsDialog bookKey='' />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(settings.setSettingsDialogOpen).toHaveBeenCalledWith(false);
  });

  it('leaves headers outside Settings out of the stack', () => {
    // Reading stats renders the same header inside its own dialog; Escape there
    // must close that dialog, not reach into a Settings level left behind.
    const onClose = vi.fn();
    const onHeaderBack = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose}>
        <SubPageHeader parentLabel='Stats' currentLabel='Monthly' onBack={onHeaderBack} />
      </Dialog>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onHeaderBack).not.toHaveBeenCalled();
  });
});
