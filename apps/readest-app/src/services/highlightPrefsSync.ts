import { BookConfig } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { SYNC_HIGHLIGHT_PREFS_BOOK_HASH } from './constants';

export interface HighlightPrefsPayload {
  customHighlightColors: Record<string, string>;
  userHighlightColors: string[];
  highlightColorLabels: Record<string, string>;
  highlightColorsUpdatedAt: number;
}

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const normalizePayload = (payload: Partial<HighlightPrefsPayload>): HighlightPrefsPayload => {
  const customHighlightColors = Object.entries(toObject(payload.customHighlightColors)).reduce(
    (acc, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  const userHighlightColors = Array.from(
    new Set(
      (Array.isArray(payload.userHighlightColors) ? payload.userHighlightColors : []).filter(
        Boolean,
      ),
    ),
  );

  const highlightColorLabels = Object.entries(toObject(payload.highlightColorLabels)).reduce(
    (acc, [key, value]) => {
      if (typeof value === 'string') {
        const label = value.trim();
        if (label) {
          acc[key] = label;
        }
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  const highlightColorsUpdatedAt =
    typeof payload.highlightColorsUpdatedAt === 'number' && payload.highlightColorsUpdatedAt > 0
      ? payload.highlightColorsUpdatedAt
      : 0;

  return {
    customHighlightColors,
    userHighlightColors,
    highlightColorLabels,
    highlightColorsUpdatedAt,
  };
};

export const getHighlightPrefsPayloadFromSettings = (
  settings: SystemSettings,
): HighlightPrefsPayload => {
  return normalizePayload(settings.globalReadSettings);
};

export const createHighlightPrefsSyncConfig = (settings: SystemSettings): BookConfig => {
  const payload = getHighlightPrefsPayloadFromSettings(settings);
  return {
    bookHash: SYNC_HIGHLIGHT_PREFS_BOOK_HASH,
    viewSettings: payload as unknown as BookConfig['viewSettings'],
    updatedAt: payload.highlightColorsUpdatedAt || Date.now(),
  };
};

export const extractHighlightPrefsPayloadFromConfigs = (
  configs?: BookConfig[] | null,
): HighlightPrefsPayload | undefined => {
  const syncConfig = configs?.find((config) => config.bookHash === SYNC_HIGHLIGHT_PREFS_BOOK_HASH);
  if (!syncConfig) return undefined;

  return normalizePayload(toObject(syncConfig.viewSettings));
};

export const applyHighlightPrefsPayloadToSettings = (
  settings: SystemSettings,
  payload: HighlightPrefsPayload,
): SystemSettings => {
  return {
    ...settings,
    globalReadSettings: {
      ...settings.globalReadSettings,
      ...payload,
    },
  };
};
