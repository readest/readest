import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Save and Back both background the app (like Home) while popping the SPA
// navigation, so the reveal happens off-screen; they differ in what they tell
// the native configure request. popNavigationOrGoToLibrary's own branching is
// covered by nav.test.ts - this file only asserts it's called.
const mocks = vi.hoisted(() => ({
  acquireBackKeyInterception: vi.fn(),
  releaseBackKeyInterception: vi.fn(),
  getBookshelfWidgetInstances: vi.fn(),
  setBookshelfWidgetSettings: vi.fn(),
  moveTaskToBack: vi.fn(),
  updateBookshelfWidget: vi.fn(),
  popNavigationOrGoToLibrary: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('appWidgetId=42'),
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/utils/nav', () => ({
  popNavigationOrGoToLibrary: mocks.popNavigationOrGoToLibrary,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => undefined,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0 } }),
}));

const appService = {
  isAndroidApp: true,
  isMobileApp: true,
  resolveFilePath: async () => '/data/Books',
};
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => appService }, appService }),
}));

vi.mock('@/utils/bridge', () => ({
  getBookshelfWidgetInstances: mocks.getBookshelfWidgetInstances,
  setBookshelfWidgetSettings: mocks.setBookshelfWidgetSettings,
  updateBookshelfWidget: mocks.updateBookshelfWidget,
  moveTaskToBack: mocks.moveTaskToBack,
}));

// Only acquire/release are asserted here; the routing decision itself is
// exercised through the real eventDispatcher + useKeyDownActions below.
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: mocks.acquireBackKeyInterception,
    releaseBackKeyInterception: mocks.releaseBackKeyInterception,
  }),
}));

import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import WidgetSettingsPage from '@/app/widget-settings/page';

describe('WidgetSettingsPage — save, cancel and Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appService.isAndroidApp = true;
    mocks.getBookshelfWidgetInstances.mockResolvedValue({ instances: [] });
    mocks.setBookshelfWidgetSettings.mockResolvedValue(undefined);
    mocks.updateBookshelfWidget.mockResolvedValue({ failed: 0 });
    mocks.moveTaskToBack.mockResolvedValue(undefined);
    useLibraryStore.getState().setLibrary([]);
  });

  afterEach(() => {
    cleanup();
  });

  const pressBack = () =>
    eventDispatcher.dispatchSync('native-key-down', { keyName: 'Back', keyCode: 4 });

  const savedShelf = () => {
    const [{ shelf }] = mocks.setBookshelfWidgetSettings.mock.lastCall as [{ shelf: string }];
    return JSON.parse(shelf);
  };

  it('acquires native back-key interception on mount and releases it on unmount', async () => {
    const { unmount } = render(<WidgetSettingsPage />);
    await waitFor(() => expect(mocks.acquireBackKeyInterception).toHaveBeenCalledTimes(1));

    expect(mocks.releaseBackKeyInterception).not.toHaveBeenCalled();
    unmount();
    expect(mocks.releaseBackKeyInterception).toHaveBeenCalledTimes(1);
  });

  it('does not acquire back-key interception outside the Android app', async () => {
    appService.isAndroidApp = false;
    render(<WidgetSettingsPage />);
    await waitFor(() => expect(mocks.getBookshelfWidgetInstances).toHaveBeenCalledTimes(1));

    expect(mocks.acquireBackKeyInterception).not.toHaveBeenCalled();
  });

  const pressHome = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it.each([
    ['native Back', () => pressBack(), true],
    ['Cancel', () => fireEvent.click(screen.getByText('Cancel')), true],
    // Home backgrounds the app itself, so there is nothing to tell native.
    ['Home', () => pressHome(), false],
  ])('%s discards the draft and cancels the placement', async (_name, leave, answersLauncher) => {
    render(<WidgetSettingsPage />);
    fireEvent.change(await screen.findByLabelText('Group by'), { target: { value: 'series' } });

    leave();

    if (answersLauncher) expect(mocks.moveTaskToBack).toHaveBeenCalledWith(false);
    else expect(mocks.moveTaskToBack).not.toHaveBeenCalled();
    expect(mocks.popNavigationOrGoToLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.setBookshelfWidgetSettings).not.toHaveBeenCalled();
  });

  it('still pops the navigation if the launcher rejects the answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.moveTaskToBack.mockRejectedValueOnce(new Error('boom'));
    render(<WidgetSettingsPage />);

    pressBack();
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Failed to answer the launcher', expect.any(Error)),
    );

    expect(mocks.popNavigationOrGoToLibrary).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("Save stores the edits in the instance's own shelf, refreshes every widget, then places it", async () => {
    const other = {
      appWidgetId: 43,
      gridRows: 1,
      gridColumns: 3,
      showTitles: false,
      groupMosaic: true,
      shelf: '',
    };
    mocks.getBookshelfWidgetInstances.mockResolvedValue({
      instances: [{ ...other, appWidgetId: 42 }, other],
    });
    render(<WidgetSettingsPage />);
    const name = (await screen.findByPlaceholderText('None')) as HTMLInputElement;
    expect(name.value).toBe('');
    // A new widget has no name, which must not stop it being made exclusive.
    expect((screen.getByLabelText(/^Exclusive/) as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText(/^Exclusive/));
    fireEvent.change(name, { target: { value: '  My Books ' } });
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'series' } });
    expect(screen.getByText('Matching books belong to the oldest exclusive widget')).toBeTruthy();
    expect(screen.getByLabelText('Include books from exclusive widgets')).toBeTruthy();
    expect(mocks.setBookshelfWidgetSettings).not.toHaveBeenCalled();

    // Rows and Columns are number steppers, starting at 1 x 3.
    const [moreRows, moreColumns] = screen.getAllByLabelText('Increase');
    fireEvent.click(moreRows!);
    fireEvent.click(moreColumns!);

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mocks.moveTaskToBack).toHaveBeenCalledWith(true));
    expect(mocks.setBookshelfWidgetSettings).toHaveBeenCalledWith(
      expect.objectContaining({ appWidgetId: 42, gridRows: 2, gridColumns: 4 }),
    );
    expect(savedShelf()).toMatchObject({
      name: 'My Books',
      groupBy: 'series',
      exclusive: true,
      useGlobalGrouping: false,
    });
    expect(mocks.updateBookshelfWidget.mock.calls.map(([r]) => r.appWidgetId).sort()).toEqual([
      42, 43,
    ]);
    expect(mocks.popNavigationOrGoToLibrary).toHaveBeenCalledTimes(1);
  });

  it('shows Mosaic covers disabled until the widget is grouped', async () => {
    render(<WidgetSettingsPage />);
    const mosaic = (await screen.findByLabelText('Mosaic covers')) as HTMLInputElement;
    expect(mosaic.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'series' } });
    expect(mosaic.disabled).toBe(false);
  });

  it('keeps a newly added blank condition in the editor and disables Save until it is complete', async () => {
    render(<WidgetSettingsPage />);
    fireEvent.click(await screen.findByText('Add condition'));

    // The default "currently reading" condition stays, and the blank one is
    // added beside it - not swapped back to the default shelf.
    expect(screen.getAllByLabelText('Filter field')).toHaveLength(2);
    expect(screen.getByRole('alert').textContent).toContain('Complete every filter condition.');

    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(mocks.setBookshelfWidgetSettings).not.toHaveBeenCalled();
  });
});
