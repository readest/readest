import { FileSystem } from '@/types/system';
import { ReadSettings, SystemSettings } from '@/types/settings';
import { DEFAULT_HIGHLIGHT_COLORS, UserHighlightColor, ViewSettings } from '@/types/book';
import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_READSETTINGS,
  SYSTEM_SETTINGS_VERSION,
  DEFAULT_TTS_CONFIG,
  DEFAULT_MOBILE_VIEW_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_CJK_VIEW_SETTINGS,
  DEFAULT_MOBILE_READSETTINGS,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  SETTINGS_FILENAME,
  DEFAULT_MOBILE_SYSTEM_SETTINGS,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_EINK_VIEW_SETTINGS,
  DEFAULT_VIEW_SETTINGS_CONFIG,
} from './constants';
import { DEFAULT_AI_SETTINGS } from './ai/constants';
import { getTargetLang, isCJKEnv } from '@/utils/misc';
import { safeLoadJSON, safeSaveJSON } from './persistence';

export interface Context {
  fs: FileSystem;
  isMobile: boolean;
  isEink: boolean;
  isAppDataSandbox: boolean;
}

export function getDefaultViewSettings(ctx: Context): ViewSettings {
  return {
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_VIEW_SETTINGS_CONFIG,
    ...(ctx.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
    ...(ctx.isEink ? DEFAULT_EINK_VIEW_SETTINGS : {}),
    ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
    ...{ ...DEFAULT_TRANSLATOR_CONFIG, translateTargetLang: getTargetLang() },
  };
}

/**
 * Normalize highlight color prefs into the current shape:
 * - `userHighlightColors` becomes `UserHighlightColor[]`. Legacy `string[]` entries
 *   are lifted into `{ hex }`. A legacy `highlightColorLabels` map (shipped only in
 *   draft builds of this feature) is folded in: hex entries attach to matching user
 *   colors, named entries move into `defaultHighlightLabels`.
 */
export function migrateHighlightColorPrefs(read: ReadSettings): void {
  const rawUser = (read.userHighlightColors ?? []) as unknown[];
  const userColors: UserHighlightColor[] = rawUser
    .map((entry) => {
      if (typeof entry === 'string') {
        return { hex: entry.trim().toLowerCase() };
      }
      if (entry && typeof entry === 'object' && 'hex' in entry) {
        const { hex, label } = entry as UserHighlightColor;
        return {
          hex: typeof hex === 'string' ? hex.trim().toLowerCase() : '',
          ...(label?.trim() ? { label: label.trim() } : {}),
        };
      }
      return { hex: '' };
    })
    .filter((entry) => entry.hex.startsWith('#'));

  read.defaultHighlightLabels = { ...(read.defaultHighlightLabels ?? {}) };

  const legacyLabels = (read as unknown as { highlightColorLabels?: unknown }).highlightColorLabels;
  if (legacyLabels && typeof legacyLabels === 'object') {
    const labels = legacyLabels as Record<string, unknown>;
    for (const name of DEFAULT_HIGHLIGHT_COLORS) {
      const value = labels[name];
      if (typeof value === 'string' && value.trim() && !read.defaultHighlightLabels[name]) {
        read.defaultHighlightLabels[name] = value.trim();
      }
    }
    for (const entry of userColors) {
      if (entry.label) continue;
      const value = labels[entry.hex];
      if (typeof value === 'string' && value.trim()) {
        entry.label = value.trim();
      }
    }
    delete (read as unknown as { highlightColorLabels?: unknown }).highlightColorLabels;
  }

  read.userHighlightColors = userColors;
}

export async function loadSettings(ctx: Context): Promise<SystemSettings> {
  const defaultSettings: SystemSettings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...(ctx.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
    version: SYSTEM_SETTINGS_VERSION,
    localBooksDir: await ctx.fs.getPrefix('Books'),
    koreaderSyncDeviceId: uuidv4(),
    globalReadSettings: {
      ...DEFAULT_READSETTINGS,
      ...(ctx.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
    },
    globalViewSettings: getDefaultViewSettings(ctx),
  } as SystemSettings;

  let settings = await safeLoadJSON<SystemSettings>(
    ctx.fs,
    SETTINGS_FILENAME,
    'Settings',
    defaultSettings,
  );

  const version = settings.version ?? 0;
  if (ctx.isAppDataSandbox || version < SYSTEM_SETTINGS_VERSION) {
    settings.version = SYSTEM_SETTINGS_VERSION;
  }
  settings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...(ctx.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
    ...settings,
  };
  settings.globalReadSettings = {
    ...DEFAULT_READSETTINGS,
    ...(ctx.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
    ...settings.globalReadSettings,
  };
  migrateHighlightColorPrefs(settings.globalReadSettings);
  settings.globalViewSettings = {
    ...getDefaultViewSettings(ctx),
    ...settings.globalViewSettings,
  };
  settings.aiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...settings.aiSettings,
  };

  settings.localBooksDir = await ctx.fs.getPrefix('Books');

  // Coerce stale `'wikipedia'` quick-action to `'dictionary'`. The Wikipedia
  // annotation tool was removed; Wikipedia is now reachable as a tab inside
  // the unified dictionary popup. Without this guard, users who had set the
  // quick action to wikipedia would get a no-op.
  if ((settings.globalViewSettings.annotationQuickAction as string) === 'wikipedia') {
    settings.globalViewSettings.annotationQuickAction = 'dictionary';
  }

  if (!settings.kosync.deviceId) {
    settings.kosync.deviceId = uuidv4();
    await saveSettings(ctx.fs, settings);
  }

  if (!settings.replicaDeviceId) {
    settings.replicaDeviceId = uuidv4();
    await saveSettings(ctx.fs, settings);
  }

  return settings;
}

export async function saveSettings(fs: FileSystem, settings: SystemSettings): Promise<void> {
  await safeSaveJSON(fs, SETTINGS_FILENAME, 'Settings', settings);
}
