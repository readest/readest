import { describe, test, expect, beforeEach, vi } from 'vitest';

const getViewSettingsMock = vi.fn<(bookKey: string) => { isGlobal?: boolean } | undefined>(
  () => undefined,
);
const setViewSettingsMock = vi.fn();
const getViewMock = vi.fn(() => null);
const getViewStateMock = vi.fn(() => undefined);

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      bookKeys: [],
      getView: getViewMock,
      getViewState: getViewStateMock,
      getViewSettings: getViewSettingsMock,
      setViewSettings: setViewSettingsMock,
    }),
  },
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: vi.fn(() => null),
      saveConfig: vi.fn(),
    }),
  },
}));

vi.mock('@/utils/style', () => ({
  getStyles: vi.fn(() => ''),
}));

import {
  getBackgroundTextureSettings,
  getLibraryViewSettings,
  isSettingsScopeGlobal,
  saveViewSettings,
} from '@/helpers/settings';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { ViewSettings } from '@/types/book';

const envConfig = {} as EnvConfigType;

const makeSettings = (): SystemSettings =>
  ({
    globalViewSettings: { userStylesheet: '', userUIStylesheet: '' },
  }) as unknown as SystemSettings;

const makeTextureSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    globalViewSettings: {
      backgroundTextureId: 'paper',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    },
    ...overrides,
  }) as unknown as SystemSettings;

beforeEach(() => {
  getViewSettingsMock.mockReset();
  getViewSettingsMock.mockReturnValue(undefined);
  setViewSettingsMock.mockReset();
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe('isSettingsScopeGlobal', () => {
  // The function reads one field. The cast hides the other `ViewSettings`
  // fields from the compiler. This function does not read them.
  const held = (isGlobal: unknown) => ({ isGlobal }) as unknown as ViewSettings;

  test('reads global with no settings to read', () => {
    // The library sends an empty key, and the store then returns null. A view
    // also holds null for the full reload.
    expect(isSettingsScopeGlobal(null)).toBe(true);
    expect(isSettingsScopeGlobal(undefined)).toBe(true);
  });

  test('reads the flag when it is a boolean, and global when it is not', () => {
    expect(isSettingsScopeGlobal(held(false))).toBe(false);
    expect(isSettingsScopeGlobal(held(true))).toBe(true);
    // A corrupt config can hold 0 or ''. Both now give global. `?? true` let
    // both values through, and the two callers then made them book scope.
    expect(isSettingsScopeGlobal(held(0))).toBe(true);
    expect(isSettingsScopeGlobal(held(''))).toBe(true);
    expect(isSettingsScopeGlobal(held(undefined))).toBe(true);
  });
});

describe('getLibraryViewSettings', () => {
  test('inherits the reader/global texture when no library override is set', () => {
    const result = getLibraryViewSettings(makeTextureSettings());

    expect(result.backgroundTextureId).toBe('paper');
    expect(result.backgroundOpacity).toBe(0.6);
    expect(result.backgroundSize).toBe('cover');
  });

  test('uses the library overrides when they are set', () => {
    const result = getLibraryViewSettings(
      makeTextureSettings({
        libraryBackgroundTextureId: 'none',
        libraryBackgroundOpacity: 0.3,
        libraryBackgroundSize: 'contain',
      }),
    );

    expect(result.backgroundTextureId).toBe('none');
    expect(result.backgroundOpacity).toBe(0.3);
    expect(result.backgroundSize).toBe('contain');
  });

  test("tolerates the store's initial empty settings (no globalViewSettings yet)", () => {
    // useSettingsStore starts as `{} as SystemSettings`; the library page's
    // texture effect can resolve before appService.loadSettings() populates it.
    // It must yield a usable "no texture" result instead of throwing.
    const result = getLibraryViewSettings({} as SystemSettings);

    expect(result.backgroundTextureId).toBe('none');
  });

  test('resolves each field independently — an unset field still inherits', () => {
    // Only the texture id is decoupled; opacity/size were never touched and
    // must keep tracking the reader/global values.
    const result = getLibraryViewSettings(
      makeTextureSettings({ libraryBackgroundTextureId: 'sand' }),
    );

    expect(result.backgroundTextureId).toBe('sand');
    expect(result.backgroundOpacity).toBe(0.6);
    expect(result.backgroundSize).toBe('cover');
  });
});

describe('getBackgroundTextureSettings', () => {
  test('library scope resolves like the library page, inheriting until decoupled', () => {
    expect(getBackgroundTextureSettings('library', makeTextureSettings())).toEqual({
      backgroundTextureId: 'paper',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    });
    expect(
      getBackgroundTextureSettings(
        'library',
        makeTextureSettings({ libraryBackgroundTextureId: 'sand' }),
      ).backgroundTextureId,
    ).toBe('sand');
  });

  test('reader scope uses the open book view settings when provided', () => {
    const readerViewSettings = {
      backgroundTextureId: 'moon',
      backgroundOpacity: 0.4,
      backgroundSize: 'auto',
    } as unknown as ViewSettings;

    expect(
      getBackgroundTextureSettings('reader', makeTextureSettings(), readerViewSettings),
    ).toEqual({
      backgroundTextureId: 'moon',
      backgroundOpacity: 0.4,
      backgroundSize: 'auto',
    });
  });

  test('reader scope falls back to global view settings when no book is open', () => {
    expect(getBackgroundTextureSettings('reader', makeTextureSettings())).toEqual({
      backgroundTextureId: 'paper',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    });
  });

  test('reader scope tolerates the initial empty settings', () => {
    expect(getBackgroundTextureSettings('reader', {} as SystemSettings)).toEqual({
      backgroundTextureId: 'none',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    });
  });
});

describe('saveViewSettings', () => {
  test('global write swaps the settings reference so replicaSettingsSync subscribers fire', async () => {
    // Mirrors the gating subscriber installed by replicaSettingsSync.initSettingsSync.
    // The publish path is bypassed entirely when this never fires, which is exactly
    // why the MiscPanel "Apply" button was failing to ship custom CSS to the server
    // until some unrelated setSettings call (e.g. dictionary provider toggle)
    // happened to create a new top-level reference and trigger a diff sweep.
    const referenceChanges: SystemSettings[] = [];
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.settings && state.settings !== prev?.settings) {
        referenceChanges.push(state.settings);
      }
    });

    try {
      await saveViewSettings(envConfig, 'book-1', 'userStylesheet', 'body { color: red; }');
    } finally {
      unsubscribe();
    }

    expect(referenceChanges).toHaveLength(1);
    expect(referenceChanges[0]!.globalViewSettings.userStylesheet).toBe('body { color: red; }');
  });

  test('global write persists with the same new reference passed to setSettings', async () => {
    let savedSettings: SystemSettings | null = null;
    const saveSettingsMock = vi.fn(async (_env: EnvConfigType, s: SystemSettings) => {
      savedSettings = s;
    });
    useSettingsStore.setState({
      saveSettings: saveSettingsMock,
    } as unknown as ReturnType<typeof useSettingsStore.getState>);

    await saveViewSettings(envConfig, 'book-1', 'userUIStylesheet', '.app { background: black; }');

    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(savedSettings!.globalViewSettings.userUIStylesheet).toBe('.app { background: black; }');
    expect(savedSettings).toBe(useSettingsStore.getState().settings);
  });

  test('the save path uses the resolver, not a truthiness test on the flag', async () => {
    // This test fails if `saveViewSettings` goes back to `?? true`. A corrupt
    // `0` is falsy, so `?? true` sends the write to the book and publishes no
    // global settings. The resolver reads global, and the subscriber then fires
    // once. A source tripwire in `scopeWiring.test.ts` also guards this call
    // site. This test guards the behaviour behind it.
    getViewSettingsMock.mockImplementation(() => ({ isGlobal: 0 }) as never);
    const referenceChanges: SystemSettings[] = [];
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.settings && state.settings !== prev?.settings) {
        referenceChanges.push(state.settings);
      }
    });

    try {
      await saveViewSettings(envConfig, 'book-1', 'userStylesheet', 'body { color: green; }');
    } finally {
      unsubscribe();
    }

    expect(referenceChanges).toHaveLength(1);
  });

  test('per-book write (isGlobal=false) does not touch the global settings reference', async () => {
    getViewSettingsMock.mockImplementation(() => ({ isGlobal: false }));
    const initial = useSettingsStore.getState().settings;
    const referenceChanges: SystemSettings[] = [];
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.settings && state.settings !== prev?.settings) {
        referenceChanges.push(state.settings);
      }
    });

    try {
      await saveViewSettings(envConfig, 'book-1', 'userStylesheet', 'body { color: blue; }');
    } finally {
      unsubscribe();
    }

    // Per-book writes go through applyViewSettings on the readerStore — they
    // must NOT publish global settings, otherwise per-book overrides would leak
    // into the cross-device globals.
    expect(referenceChanges).toHaveLength(0);
    expect(useSettingsStore.getState().settings).toBe(initial);
  });
});
