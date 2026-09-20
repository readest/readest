import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { eventDispatcher } from '@/utils/event';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isAndroidApp: true } }) }));
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
const { default: FileSyncReport } = await import('@/components/FileSyncReport');

beforeEach(() => useFileSyncStore.setState({ reportByKind: {}, lastErrorByKind: {} }));
afterEach(cleanup);

test.each(['Escape', 'Back'])('%s dismisses successive provider reports', (key) => {
  const store = useFileSyncStore.getState();
  store.setLastError('webdav', 'WebDAV failed');
  store.setLastError('gdrive', 'Drive failed');
  render(<FileSyncReport />);
  const dismiss = () =>
    act(() => {
      if (key === 'Escape') fireEvent.keyDown(window, { key });
      else eventDispatcher.dispatchSync('native-key-down', { keyName: key });
    });
  dismiss();
  expect(useFileSyncStore.getState().reportByKind.webdav).toBeNull();
  expect(useFileSyncStore.getState().reportByKind.gdrive).toBe('Drive failed');
  dismiss();
  expect(useFileSyncStore.getState().reportByKind.gdrive).toBeNull();
  expect(useFileSyncStore.getState().lastErrorByKind.gdrive).toBe('Drive failed');
});
