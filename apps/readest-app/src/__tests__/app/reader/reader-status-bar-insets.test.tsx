import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reader hides the status bar while reading and shows it with the toolbar. On
 * iPhone Duo the strip carries a side inset of its own, so the insets are
 * re-read once the visibility change lands (#6307). Every other device does not
 * re-read: base never did, and on a phone without a notch the top inset goes
 * 20 -> 0 with the bar, which a re-read would now apply to the layout.
 */

const h = vi.hoisted(() => ({
  setSystemUIVisibility: vi.fn(() => Promise.resolve({ success: true })),
  onUpdateInsets: vi.fn(),
  hoveredBookKey: '',
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: true, isIOSApp: true, isAndroidApp: false } }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ onUpdateInsets: h.onUpdateInsets }) }));
vi.mock('@/hooks/useLibrary', () => ({ useLibrary: () => ({ libraryLoaded: false }) }));
vi.mock('@/hooks/useScreenWakeLock', () => ({ useScreenWakeLock: vi.fn() }));
vi.mock('@/app/reader/hooks/useScreenBrightness', () => ({ useScreenBrightness: vi.fn() }));
vi.mock('@/hooks/useTransferQueue', () => ({ useTransferQueue: vi.fn() }));
vi.mock('@/hooks/useReplicaPull', () => ({ useReplicaPull: vi.fn() }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { alwaysShowStatusBar: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ hoveredBookKey: h.hoveredBookKey }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ getIsSideBarVisible: () => false }),
}));
vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({ getIsNotebookVisible: () => false }),
}));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));
vi.mock('@/styles/fonts', () => ({ mountAdditionalFonts: vi.fn() }));
vi.mock('@/utils/open', () => ({ interceptWindowOpen: vi.fn() }));
vi.mock('@/utils/time', () => ({ initDayjs: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: vi.fn(),
  setSystemUIVisibility: h.setSystemUIVisibility,
}));
vi.mock('@/components/AboutWindow', () => ({ AboutWindow: () => null }));
vi.mock('@/components/KeyboardShortcutsHelp', () => ({ KeyboardShortcutsHelp: () => null }));
vi.mock('@/components/UpdaterWindow', () => ({ UpdaterWindow: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/reader/components/ProofreadRules', () => ({ ProofreadRulesManager: () => null }));
vi.mock('@/app/reader/components/ReaderContent', () => ({ default: () => null }));

import { useThemeStore } from '@/store/themeStore';
import Reader from '@/app/reader/components/Reader';

beforeEach(() => {
  useThemeStore.setState({ systemUIAlwaysHidden: false, isIPhoneDuo: false });
  h.setSystemUIVisibility.mockClear();
  h.onUpdateInsets.mockClear();
});

afterEach(cleanup);

describe('Reader status bar visibility', () => {
  it('does not re-read the insets off iPhone Duo (base behaviour)', async () => {
    render(<Reader />);
    await act(async () => {});
    expect(h.setSystemUIVisibility).toHaveBeenCalledTimes(1);
    expect(h.onUpdateInsets).not.toHaveBeenCalled();
  });

  it('re-reads the insets on iPhone Duo', async () => {
    useThemeStore.setState({ isIPhoneDuo: true });
    render(<Reader />);
    await act(async () => {});
    expect(h.setSystemUIVisibility).toHaveBeenCalledTimes(1);
    expect(h.onUpdateInsets).toHaveBeenCalledTimes(1);
  });
});
