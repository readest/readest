import { create } from 'zustand';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';
import { getThemeCode, ThemeCode } from '@/utils/style';
import {
  getSystemColorScheme,
  startAmbientLightUpdates,
  stopAmbientLightUpdates,
  type AmbientLightPayload,
} from '@/utils/bridge';
import {
  isValidThemeMode,
  readStoredAmbientIsDarkMode,
  resolveAmbientIsDarkMode,
  resolveThemeIsDarkMode,
} from '@/utils/ambientLight';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CustomTheme, Palette, ThemeMode, ThemeScope } from '@/styles/themes';
import { EnvConfigType, isWebAppPlatform } from '@/services/environment';
import { SystemSettings } from '@/types/settings';
import { Insets } from '@/types/misc';

declare global {
  interface Window {
    __READEST_IS_EINK?: boolean;
    onNativeColorSchemeChange?: (colorScheme: 'light' | 'dark') => void;
  }
}

interface ThemeState {
  /**
   * The theme currently painted on screen — the resolved values for
   * `themeScope`, not raw storage. Everything that just wants to know "what
   * does the UI look like right now" reads these (issue #5945).
   */
  themeMode: ThemeMode;
  themeColor: string;
  /** Which page's theme is applied. Every non-reader route is 'library'. */
  themeScope: ThemeScope;
  /**
   * The reader pair, persisted under the original `themeMode`/`themeColor`
   * keys. `getThemeCode` reads those same keys, so book content and reader
   * overlays follow this pair without any coupling to the scope machinery.
   */
  readerThemeMode: ThemeMode;
  readerThemeColor: string;
  /**
   * Library overrides; null means "inherit the reader pair", exactly like the
   * undefined `libraryBackgroundTextureId` fields (#4743). Absent until the
   * user picks a library value in Settings → Theme, so an upgrade changes
   * nothing about how the app looks or how the quick toggles behave.
   */
  libraryThemeMode: ThemeMode | null;
  libraryThemeColor: string | null;
  systemIsDarkMode: boolean;
  ambientIsDarkMode: boolean;
  themeCode: ThemeCode;
  isDarkMode: boolean;
  systemUIVisible: boolean;
  statusBarHeight: number;
  systemUIAlwaysHidden: boolean;
  safeAreaInsets: Insets | null;
  isRoundedWindow: boolean;
  setSystemUIAlwaysHidden: (hidden: boolean) => void;
  setStatusBarHeight: (height: number) => void;
  showSystemUI: () => void;
  dismissSystemUI: () => void;
  getIsDarkMode: () => boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  setThemeScope: (scope: ThemeScope) => void;
  setScopedThemeMode: (scope: ThemeScope, mode: ThemeMode) => void;
  setScopedThemeColor: (scope: ThemeScope, color: string) => void;
  getScopedTheme: (scope: ThemeScope) => { themeMode: ThemeMode; themeColor: string };
  resetThemeScopes: () => void;
  updateAppTheme: (color: keyof Palette) => void;
  saveCustomTheme: (
    envConfig: EnvConfigType,
    settings: SystemSettings,
    theme: CustomTheme,
    isDelete?: boolean,
  ) => void;
  handleSystemThemeChange: (isDark: boolean) => void;
  handleAmbientLightChange: (lux: number) => void;
  updateSafeAreaInsets: (insets: Insets) => void;
}

const LIBRARY_THEME_MODE_KEY = 'libraryThemeMode';
const LIBRARY_THEME_COLOR_KEY = 'libraryThemeColor';

const getInitialThemeMode = (): ThemeMode => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem('themeMode');
    if (isValidThemeMode(stored)) return stored;
  }
  return 'auto';
};

const getInitialThemeColor = (): string => {
  if (typeof window !== 'undefined' && localStorage) {
    const defaultColor = window.__READEST_IS_EINK ? 'contrast' : 'default';
    return localStorage.getItem('themeColor') || defaultColor;
  }
  return 'default';
};

const getInitialLibraryThemeMode = (): ThemeMode | null => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem(LIBRARY_THEME_MODE_KEY);
    if (isValidThemeMode(stored)) return stored;
  }
  return null;
};

const getInitialLibraryThemeColor = (): string | null => {
  if (typeof window !== 'undefined' && localStorage) {
    return localStorage.getItem(LIBRARY_THEME_COLOR_KEY) || null;
  }
  return null;
};

const getInitialAmbientIsDarkMode = (systemIsDarkMode: boolean): boolean => {
  if (typeof window !== 'undefined' && localStorage) {
    return readStoredAmbientIsDarkMode(localStorage.getItem('ambientIsDarkMode'), systemIsDarkMode);
  }
  return systemIsDarkMode;
};

const persistAmbientIsDarkMode = (isDark: boolean) => {
  if (typeof window !== 'undefined' && localStorage) {
    localStorage.setItem('ambientIsDarkMode', isDark ? 'true' : 'false');
  }
};

const applyDataTheme = (themeColor: string, isDarkMode: boolean) => {
  document.documentElement.setAttribute(
    'data-theme',
    `${themeColor}-${isDarkMode ? 'dark' : 'light'}`,
  );
};

/**
 * Resolve one scope's pair from the raw stored values. The reader pair is the
 * base; the library falls back to it per field, so a user who only overrides
 * the mode keeps following the reader's color.
 */
const resolveScopedTheme = (
  scope: ThemeScope,
  raw: Pick<
    ThemeState,
    'readerThemeMode' | 'readerThemeColor' | 'libraryThemeMode' | 'libraryThemeColor'
  >,
): { themeMode: ThemeMode; themeColor: string } => {
  if (scope === 'reader') {
    return { themeMode: raw.readerThemeMode, themeColor: raw.readerThemeColor };
  }
  return {
    themeMode: raw.libraryThemeMode ?? raw.readerThemeMode,
    themeColor: raw.libraryThemeColor ?? raw.readerThemeColor,
  };
};

/**
 * The reader owns `/reader`; everything else (library, settings, OPDS, player,
 * auth) shares the library scope so no route paints a third look.
 */
export const getThemeScopeForPath = (pathname?: string): ThemeScope => {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return path.startsWith('/reader') ? 'reader' : 'library';
};

let ambientLightListener: PluginListener | null = null;
let ambientLightListening = false;
let ambientHasLuxReading = false;

const stopAmbientLightListening = async () => {
  if (ambientLightListener) {
    try {
      await ambientLightListener.unregister();
    } catch {
      // ignore unregister races on teardown
    }
    ambientLightListener = null;
  }
  if (ambientLightListening) {
    ambientLightListening = false;
    try {
      await stopAmbientLightUpdates();
    } catch {
      // platform may not support ambient light
    }
  }
  ambientHasLuxReading = false;
};

const startAmbientLightListening = async () => {
  if (ambientLightListening) return;
  try {
    const started = await startAmbientLightUpdates();
    if (!started.success) {
      useThemeStore.getState().setThemeMode('auto');
      return;
    }
    ambientLightListening = true;
    ambientLightListener = await addPluginListener<AmbientLightPayload>(
      'native-bridge',
      'ambient-light',
      (payload) => {
        if (typeof payload?.lux === 'number') {
          useThemeStore.getState().handleAmbientLightChange(payload.lux);
        }
      },
    );
  } catch {
    useThemeStore.getState().setThemeMode('auto');
  }
};

// Start and stop both span several awaits, so overlapping calls could
// interleave: a stop landing after a start leaves the sensor off while we
// still believe we are listening, and two starts leak the first listener.
// Chaining every transition keeps the sensor in step with the last mode set.
let ambientLightSync: Promise<void> = Promise.resolve();

const syncAmbientLightSubscription = (mode: ThemeMode) => {
  ambientLightSync = ambientLightSync.then(() =>
    mode === 'ambient' ? startAmbientLightListening() : stopAmbientLightListening(),
  );
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialThemeMode = getInitialThemeMode();
  const initialThemeColor = getInitialThemeColor();
  const initialLibraryThemeMode = getInitialLibraryThemeMode();
  const initialLibraryThemeColor = getInitialLibraryThemeColor();
  const systemIsDarkMode =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const initialScope = getThemeScopeForPath();
  const initialEffective = resolveScopedTheme(initialScope, {
    readerThemeMode: initialThemeMode,
    readerThemeColor: initialThemeColor,
    libraryThemeMode: initialLibraryThemeMode,
    libraryThemeColor: initialLibraryThemeColor,
  });
  const isDarkMode = resolveThemeIsDarkMode(
    initialEffective.themeMode,
    systemIsDarkMode,
    ambientIsDarkMode,
  );
  const themeCode = getThemeCode();

  /**
   * Recompute the active scope's pair after a change and paint it. Writes that
   * land on the scope the user is NOT looking at resolve to the same effective
   * values, so this is a no-op repaint for them — which is what keeps editing
   * the library theme from repainting an open book (the rule the background
   * texture scope already follows, #4743).
   *
   * `refreshThemeCode` is set only when the reader pair or the system/ambient
   * flags moved. `themeCode` feeds the CSS injected into the book iframe, and
   * handing it a fresh object identity re-runs the reader's style effects.
   */
  const applyActiveScope = (patch: Partial<ThemeState>, refreshThemeCode: boolean) => {
    const next = { ...get(), ...patch };
    const effective = resolveScopedTheme(next.themeScope, next);
    const nextIsDarkMode = resolveThemeIsDarkMode(
      effective.themeMode,
      next.systemIsDarkMode,
      next.ambientIsDarkMode,
    );
    applyDataTheme(effective.themeColor, nextIsDarkMode);
    set({
      ...patch,
      themeMode: effective.themeMode,
      themeColor: effective.themeColor,
      isDarkMode: nextIsDarkMode,
      ...(refreshThemeCode ? { themeCode: getThemeCode() } : {}),
    });
    return effective.themeMode;
  };

  return {
    themeMode: initialEffective.themeMode,
    themeColor: initialEffective.themeColor,
    themeScope: initialScope,
    readerThemeMode: initialThemeMode,
    readerThemeColor: initialThemeColor,
    libraryThemeMode: initialLibraryThemeMode,
    libraryThemeColor: initialLibraryThemeColor,
    systemIsDarkMode,
    ambientIsDarkMode,
    isDarkMode,
    themeCode,
    systemUIVisible: false,
    statusBarHeight: 24,
    systemUIAlwaysHidden: false,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isRoundedWindow: true,
    showSystemUI: () => set({ systemUIVisible: true }),
    dismissSystemUI: () => set({ systemUIVisible: false }),
    setStatusBarHeight: (height: number) => set({ statusBarHeight: height }),
    setSystemUIAlwaysHidden: (hidden: boolean) => set({ systemUIAlwaysHidden: hidden }),
    getIsDarkMode: () => get().isDarkMode,
    getScopedTheme: (scope) => resolveScopedTheme(scope, get()),
    setThemeScope: (scope) => {
      if (get().themeScope === scope) return;
      const mode = applyActiveScope({ themeScope: scope }, false);
      syncAmbientLightSubscription(mode);
    },
    // The quick toggles (library settings menu, reader view menu, reader color
    // panel, command palette) route through here. While the library is still
    // inheriting, a toggle from either page writes the shared reader pair so
    // both pages move together exactly as they did before #5945 — only an
    // explicit library edit in Settings → Theme decouples the two.
    setThemeMode: (mode) => {
      const { themeScope, libraryThemeMode } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryThemeMode !== null ? 'library' : 'reader';
      get().setScopedThemeMode(target, mode);
    },
    setThemeColor: (color) => {
      const { themeScope, libraryThemeColor } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryThemeColor !== null ? 'library' : 'reader';
      get().setScopedThemeColor(target, color);
    },
    setScopedThemeMode: (scope, mode) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(isReader ? 'themeMode' : LIBRARY_THEME_MODE_KEY, mode);
      }
      const activeMode = applyActiveScope(
        isReader ? { readerThemeMode: mode } : { libraryThemeMode: mode },
        isReader,
      );
      syncAmbientLightSubscription(activeMode);
    },
    setScopedThemeColor: (scope, color) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(isReader ? 'themeColor' : LIBRARY_THEME_COLOR_KEY, color);
      }
      applyActiveScope(
        isReader ? { readerThemeColor: color } : { libraryThemeColor: color },
        isReader,
      );
    },
    // "Reset to defaults" has to drop the library override too, otherwise a
    // decoupled library keeps its old look and the reset looks broken.
    resetThemeScopes: () => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeMode', 'auto');
        localStorage.setItem('themeColor', 'default');
        localStorage.removeItem(LIBRARY_THEME_MODE_KEY);
        localStorage.removeItem(LIBRARY_THEME_COLOR_KEY);
      }
      const activeMode = applyActiveScope(
        {
          readerThemeMode: 'auto',
          readerThemeColor: 'default',
          libraryThemeMode: null,
          libraryThemeColor: null,
        },
        true,
      );
      syncAmbientLightSubscription(activeMode);
    },
    updateAppTheme: (color) => {
      if (isWebAppPlatform()) {
        const { palette } = get().themeCode;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[color]);
      }
    },
    saveCustomTheme: async (envConfig, settings, theme, isDelete) => {
      const customThemes = settings.globalReadSettings.customThemes || [];
      const index = customThemes.findIndex((t) => t.name === theme.name);
      if (isDelete) {
        if (index > -1) {
          customThemes.splice(index, 1);
        }
      } else {
        if (index > -1) {
          customThemes[index] = theme;
        } else {
          customThemes.push(theme);
        }
      }
      settings.globalReadSettings.customThemes = customThemes;
      localStorage.setItem('customThemes', JSON.stringify(customThemes));
      const appService = await envConfig.getAppService();
      await appService.saveSettings(settings);
    },
    handleSystemThemeChange: (systemIsDarkMode) => {
      applyActiveScope({ systemIsDarkMode }, true);
    },
    handleAmbientLightChange: (lux) => {
      if (get().themeMode !== 'ambient') return;
      const previous = ambientHasLuxReading ? get().ambientIsDarkMode : null;
      ambientHasLuxReading = true;
      const nextAmbientIsDark = resolveAmbientIsDarkMode(lux, previous);
      if (nextAmbientIsDark === get().ambientIsDarkMode && get().isDarkMode === nextAmbientIsDark) {
        return;
      }
      persistAmbientIsDarkMode(nextAmbientIsDark);
      applyActiveScope({ ambientIsDarkMode: nextAmbientIsDark }, true);
    },
    updateSafeAreaInsets: (insets) => {
      set({ safeAreaInsets: insets });
    },
  };
});

export const loadDataTheme = (scope: ThemeScope = getThemeScopeForPath()) => {
  if (typeof localStorage === 'undefined' || typeof document === 'undefined') return;

  const themeMode = localStorage.getItem('themeMode');
  const themeColor = localStorage.getItem('themeColor');
  const libraryThemeMode = getInitialLibraryThemeMode();
  const libraryThemeColor = getInitialLibraryThemeColor();
  // Nothing configured at all: leave the attribute alone and let useTheme
  // paint the default. A library-only override still counts as configured —
  // decoupling the library writes only its own key, so a user who never
  // touched the reader theme has no reader keys to gate on, and checking
  // those alone would skip the early paint in exactly that case.
  if (!(themeMode && themeColor) && !libraryThemeMode && !libraryThemeColor) return;

  const systemIsDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const effective = resolveScopedTheme(scope, {
    // Via the same helpers the store initializes from, so an absent reader key
    // resolves to the implicit default rather than a null in the attribute.
    readerThemeMode: getInitialThemeMode(),
    readerThemeColor: getInitialThemeColor(),
    libraryThemeMode,
    libraryThemeColor,
  });
  const isDarkMode = resolveThemeIsDarkMode(
    effective.themeMode,
    systemIsDarkMode,
    ambientIsDarkMode,
  );
  applyDataTheme(effective.themeColor, isDarkMode);
};

export const initSystemThemeListener = (appService: AppService) => {
  if (typeof window === 'undefined' || !appService) return;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const applySystemTheme = (systemIsDarkMode: boolean) => {
    if (typeof window !== 'undefined' && localStorage) {
      localStorage.setItem('systemIsDarkMode', systemIsDarkMode ? 'true' : 'false');
    }
    useThemeStore.getState().handleSystemThemeChange(systemIsDarkMode);
  };
  const updateColorTheme = async () => {
    let systemIsDarkMode;
    if (appService.isIOSApp) {
      const res = await getSystemColorScheme();
      systemIsDarkMode = res.colorScheme === 'dark';
    } else {
      systemIsDarkMode = mediaQuery.matches;
    }
    applySystemTheme(systemIsDarkMode);
  };

  const updateWindowTheme = async () => {
    if (!appService.hasWindow || !appService.isLinuxApp) return;
    const currentWindow = getCurrentWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    const isMaximized = await currentWindow.isMaximized();
    useThemeStore.setState({ isRoundedWindow: !isMaximized && !isFullscreen });
  };

  const syncAmbientForVisibility = () => {
    const mode = useThemeStore.getState().themeMode;
    if (document.visibilityState === 'visible') {
      syncAmbientLightSubscription(mode);
    } else {
      void stopAmbientLightListening();
    }
  };

  mediaQuery?.addEventListener('change', updateColorTheme);
  document.addEventListener('visibilitychange', () => {
    void updateColorTheme();
    syncAmbientForVisibility();
  });
  window.addEventListener('resize', updateWindowTheme);

  // iOS WKWebView never fires the `prefers-color-scheme` media query
  // `change` event while the app stays foregrounded (e.g. toggling dark
  // mode from Control Center), so the native plugin pushes the new
  // appearance through this callback instead.
  if (appService.isIOSApp) {
    window.onNativeColorSchemeChange = (colorScheme) => {
      applySystemTheme(colorScheme === 'dark');
    };
  }

  updateColorTheme();

  // appService.init() has already probed the sensor by the time this runs, so
  // fall back when Ambient Mode was persisted on a device that lacks one.
  const themeMode = useThemeStore.getState().themeMode;
  if (themeMode === 'ambient' && !appService.hasAmbientLightSensor) {
    useThemeStore.getState().setThemeMode('auto');
  } else {
    syncAmbientLightSubscription(themeMode);
  }
};
