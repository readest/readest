// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  appPlatform: 'web' as 'web' | 'tauri',
  hasSafeAreaInset: true,
  libraryLoaded: true,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      isMobileApp: h.appPlatform === 'tauri',
      isIOSApp: false,
      isAndroidApp: false,
      appPlatform: h.appPlatform,
      hasSafeAreaInset: h.hasSafeAreaInset,
      hasRoundedWindow: false,
    },
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ onUpdateInsets: vi.fn() }) }));
vi.mock('@/hooks/useLibrary', () => ({ useLibrary: () => ({ libraryLoaded: h.libraryLoaded }) }));
vi.mock('@/hooks/useScreenWakeLock', () => ({ useScreenWakeLock: vi.fn() }));
vi.mock('@/app/reader/hooks/useScreenBrightness', () => ({ useScreenBrightness: vi.fn() }));
vi.mock('@/hooks/useTransferQueue', () => ({ useTransferQueue: vi.fn() }));
vi.mock('@/hooks/useReplicaPull', () => ({ useReplicaPull: vi.fn() }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { alwaysShowStatusBar: false, globalReadSettings: {} } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ hoveredBookKey: '' }),
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
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => h.appPlatform === 'tauri',
}));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: vi.fn(),
  setSystemUIVisibility: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('@/components/AboutWindow', () => ({ AboutWindow: () => null }));
vi.mock('@/components/stats/ReadingStatsDialog', () => ({ default: () => null }));
vi.mock('@/components/vocabulary/VocabularyDialog', () => ({ VocabularyDialog: () => null }));
vi.mock('@/components/KeyboardShortcutsHelp', () => ({ KeyboardShortcutsHelp: () => null }));
vi.mock('@/components/UpdaterWindow', () => ({ UpdaterWindow: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/reader/components/ProofreadRules', () => ({ ProofreadRulesManager: () => null }));
vi.mock('@/app/reader/components/ReaderContent', () => ({ default: () => null }));

import Reader from '@/app/reader/components/Reader';

beforeEach(() => {
  h.appPlatform = 'web';
  h.hasSafeAreaInset = true;
  h.libraryLoaded = true;
});

afterEach(cleanup);

describe('Reader Web PWA viewport pinning', () => {
  it('pins .reader-page to fixed inset-0 on Web PWA', () => {
    const { container } = render(<Reader />);
    const root = container.querySelector('.reader-page') as HTMLElement;
    expect(root.classList.contains('fixed')).toBe(true);
    expect(root.classList.contains('inset-0')).toBe(true);
  });

  it('pins the unloaded Reader fallback to fixed inset-0 bg-base-100 on Web PWA', () => {
    h.libraryLoaded = false;
    const { container } = render(<Reader />);
    const fallback = container.firstElementChild as HTMLElement;
    expect(fallback.classList.contains('fixed')).toBe(true);
    expect(fallback.classList.contains('inset-0')).toBe(true);
    expect(fallback.classList.contains('bg-base-100')).toBe(true);
  });

  it('does not add fixed inset-0 on non-web platforms', () => {
    h.appPlatform = 'tauri';
    const { container } = render(<Reader />);
    const root = container.querySelector('.reader-page') as HTMLElement;
    expect(root.classList.contains('fixed')).toBe(false);
    expect(root.classList.contains('inset-0')).toBe(false);
  });
});
