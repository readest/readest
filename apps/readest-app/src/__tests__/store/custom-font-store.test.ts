import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useCustomFontStore } from '@/store/customFontStore';
import { useSettingsStore } from '@/store/settingsStore';
import { CustomFont } from '@/styles/fonts';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';

function makeFont(overrides: Partial<CustomFont> & { id: string; name: string }): CustomFont {
  return {
    path: `/fonts/${overrides.name}.ttf`,
    ...overrides,
  };
}

function createMockEnvConfig(): EnvConfigType {
  return {
    getAppService: vi.fn(),
  } as unknown as EnvConfigType;
}

beforeEach(() => {
  useCustomFontStore.setState({
    fonts: [],
    loading: false,
  });
  useSettingsStore.setState({
    settings: {} as SystemSettings,
  });
});

describe('customFontStore', () => {
  // ── setFonts ───────────────────────────────────────────────────
  describe('setFonts', () => {
    test('sets fonts array', () => {
      const fonts: CustomFont[] = [
        makeFont({ id: 'f1', name: 'Roboto', path: '/fonts/Roboto.ttf' }),
      ];
      useCustomFontStore.getState().setFonts(fonts);
      expect(useCustomFontStore.getState().fonts).toEqual(fonts);
    });

    test('overwrites existing fonts', () => {
      useCustomFontStore.getState().setFonts([makeFont({ id: 'a', name: 'A', path: '/a.ttf' })]);
      const newFonts = [makeFont({ id: 'b', name: 'B', path: '/b.ttf' })];
      useCustomFontStore.getState().setFonts(newFonts);
      expect(useCustomFontStore.getState().fonts).toHaveLength(1);
      expect(useCustomFontStore.getState().fonts[0]!.id).toBe('b');
    });
  });

  // ── addFont ────────────────────────────────────────────────────
  describe('addFont', () => {
    test('adds a new font from a path', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/MyFont.ttf');
      expect(font).toBeDefined();
      expect(font.name).toBe('MyFont');
      expect(font.path).toBe('/fonts/MyFont.ttf');
      expect(useCustomFontStore.getState().fonts).toHaveLength(1);
    });

    test('sets downloadedAt on new font', () => {
      const before = Date.now();
      useCustomFontStore.getState().addFont('/fonts/Test.otf');
      const f = useCustomFontStore.getState().fonts[0]!;
      expect(f.downloadedAt).toBeGreaterThanOrEqual(before);
    });

    test('accepts options (family, style, weight, variable)', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/Custom.woff2', {
        family: 'Custom Family',
        style: 'italic',
        weight: 700,
        variable: true,
      });
      expect(font.family).toBe('Custom Family');
      expect(font.style).toBe('italic');
      expect(font.weight).toBe(700);
      expect(font.variable).toBe(true);
    });

    test('returns existing font when adding duplicate path', () => {
      const first = useCustomFontStore.getState().addFont('/fonts/MyFont.ttf');
      const second = useCustomFontStore.getState().addFont('/fonts/MyFont.ttf');
      expect(second.id).toBe(first.id);
      expect(useCustomFontStore.getState().fonts).toHaveLength(1);
    });

    test('re-adding same font clears deletedAt', () => {
      useCustomFontStore.getState().addFont('/fonts/MyFont.ttf');
      useCustomFontStore.getState().removeFont(useCustomFontStore.getState().fonts[0]!.id);
      const deleted = useCustomFontStore.getState().fonts[0]!;
      expect(deleted.deletedAt).toBeDefined();

      useCustomFontStore.getState().addFont('/fonts/MyFont.ttf');
      const restored = useCustomFontStore.getState().fonts[0]!;
      expect(restored.deletedAt).toBeUndefined();
    });
  });

  // ── removeFont ─────────────────────────────────────────────────
  describe('removeFont', () => {
    test('marks a font as deleted', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/Test.ttf');
      const result = useCustomFontStore.getState().removeFont(font.id);
      expect(result).toBe(true);
      const removed = useCustomFontStore.getState().getFont(font.id);
      expect(removed?.deletedAt).toBeDefined();
    });

    test('returns false for non-existent id', () => {
      const result = useCustomFontStore.getState().removeFont('nonexistent');
      expect(result).toBe(false);
    });

    test('clears blobUrl and loaded state', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/Test.ttf');
      useCustomFontStore.getState().updateFont(font.id, {
        blobUrl: 'blob:test',
        loaded: true,
      });
      useCustomFontStore.getState().removeFont(font.id);
      const removed = useCustomFontStore.getState().getFont(font.id);
      expect(removed?.blobUrl).toBeUndefined();
      expect(removed?.loaded).toBe(false);
    });
  });

  // ── updateFont ─────────────────────────────────────────────────
  describe('updateFont', () => {
    test('updates fields on an existing font', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/Test.woff');
      const result = useCustomFontStore.getState().updateFont(font.id, {
        loaded: true,
        blobUrl: 'blob:abc',
      });
      expect(result).toBe(true);
      const updated = useCustomFontStore.getState().getFont(font.id);
      expect(updated?.loaded).toBe(true);
      expect(updated?.blobUrl).toBe('blob:abc');
    });

    test('returns false for non-existent id', () => {
      const result = useCustomFontStore.getState().updateFont('missing', { loaded: true });
      expect(result).toBe(false);
    });
  });

  // ── getFont ────────────────────────────────────────────────────
  describe('getFont', () => {
    test('returns the font by id', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/Lato.otf');
      const found = useCustomFontStore.getState().getFont(font.id);
      expect(found?.name).toBe('Lato');
    });

    test('returns undefined for unknown id', () => {
      expect(useCustomFontStore.getState().getFont('nope')).toBeUndefined();
    });
  });

  // ── getAllFonts ─────────────────────────────────────────────────
  describe('getAllFonts', () => {
    test('returns all fonts including deleted', () => {
      const f1 = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().addFont('/b.ttf');
      useCustomFontStore.getState().removeFont(f1.id);
      expect(useCustomFontStore.getState().getAllFonts()).toHaveLength(2);
    });
  });

  // ── getAvailableFonts ──────────────────────────────────────────
  describe('getAvailableFonts', () => {
    test('excludes deleted fonts', () => {
      const f1 = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().addFont('/b.ttf');
      useCustomFontStore.getState().removeFont(f1.id);
      const available = useCustomFontStore.getState().getAvailableFonts();
      expect(available).toHaveLength(1);
      expect(available[0]!.name).toBe('b');
    });

    test('returns empty array when all deleted', () => {
      const f1 = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().removeFont(f1.id);
      expect(useCustomFontStore.getState().getAvailableFonts()).toHaveLength(0);
    });
  });

  // ── clearAllFonts ──────────────────────────────────────────────
  describe('clearAllFonts', () => {
    test('removes all fonts', () => {
      useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().addFont('/b.ttf');
      useCustomFontStore.getState().clearAllFonts();
      expect(useCustomFontStore.getState().fonts).toHaveLength(0);
    });
  });

  // ── unloadFont ─────────────────────────────────────────────────
  describe('unloadFont', () => {
    test('clears loaded state and blobUrl', () => {
      const font = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().updateFont(font.id, {
        loaded: true,
        blobUrl: 'blob:test',
      });
      const result = useCustomFontStore.getState().unloadFont(font.id);
      expect(result).toBe(true);
      const f = useCustomFontStore.getState().getFont(font.id);
      expect(f?.loaded).toBe(false);
      expect(f?.blobUrl).toBeUndefined();
    });

    test('returns false for non-existent font', () => {
      const result = useCustomFontStore.getState().unloadFont('nope');
      expect(result).toBe(false);
    });
  });

  // ── unloadAllFonts ─────────────────────────────────────────────
  describe('unloadAllFonts', () => {
    test('unloads all fonts', () => {
      const f1 = useCustomFontStore.getState().addFont('/a.ttf');
      const f2 = useCustomFontStore.getState().addFont('/b.ttf');
      useCustomFontStore.getState().updateFont(f1.id, { loaded: true, blobUrl: 'blob:1' });
      useCustomFontStore.getState().updateFont(f2.id, { loaded: true, blobUrl: 'blob:2' });

      useCustomFontStore.getState().unloadAllFonts();

      for (const f of useCustomFontStore.getState().getAllFonts()) {
        expect(f.loaded).toBe(false);
        expect(f.blobUrl).toBeUndefined();
      }
    });
  });

  // ── getFontFamilies ────────────────────────────────────────────
  describe('getFontFamilies', () => {
    test('returns unique sorted families from loaded fonts', () => {
      const f1 = useCustomFontStore.getState().addFont('/fonts/Roboto.ttf', {
        family: 'Roboto',
      });
      const f2 = useCustomFontStore.getState().addFont('/fonts/Lato.ttf', {
        family: 'Lato',
      });
      const f3 = useCustomFontStore.getState().addFont('/fonts/RobotoBold.ttf', {
        name: 'RobotoBold',
        family: 'Roboto',
      });
      useCustomFontStore.getState().updateFont(f1.id, { loaded: true });
      useCustomFontStore.getState().updateFont(f2.id, { loaded: true });
      useCustomFontStore.getState().updateFont(f3.id, { loaded: true });

      const families = useCustomFontStore.getState().getFontFamilies();
      expect(families).toEqual(['Lato', 'Roboto']);
    });

    test('excludes unloaded and errored fonts', () => {
      const f1 = useCustomFontStore.getState().addFont('/fonts/Good.ttf', { family: 'Good' });
      const f2 = useCustomFontStore.getState().addFont('/fonts/Bad.ttf', { family: 'Bad' });
      useCustomFontStore.getState().updateFont(f1.id, { loaded: true });
      useCustomFontStore.getState().updateFont(f2.id, { loaded: true, error: 'fail' });

      const families = useCustomFontStore.getState().getFontFamilies();
      expect(families).toEqual(['Good']);
    });

    test('falls back to name when family is not set', () => {
      const font = useCustomFontStore.getState().addFont('/fonts/NoFamily.ttf');
      useCustomFontStore.getState().updateFont(font.id, { loaded: true });
      const families = useCustomFontStore.getState().getFontFamilies();
      expect(families).toEqual(['NoFamily']);
    });

    test('returns empty array when no fonts loaded', () => {
      useCustomFontStore.getState().addFont('/fonts/Test.ttf');
      expect(useCustomFontStore.getState().getFontFamilies()).toEqual([]);
    });
  });

  // ── getLoadedFonts / isFontLoaded ──────────────────────────────
  describe('getLoadedFonts', () => {
    test('returns only loaded non-deleted fonts', () => {
      const f1 = useCustomFontStore.getState().addFont('/a.ttf');
      const f2 = useCustomFontStore.getState().addFont('/b.ttf');
      useCustomFontStore.getState().updateFont(f1.id, { loaded: true });
      useCustomFontStore.getState().updateFont(f2.id, { loaded: false });
      const loaded = useCustomFontStore.getState().getLoadedFonts();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe(f1.id);
    });

    test('excludes fonts with errors', () => {
      const f1 = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().updateFont(f1.id, { loaded: true, error: 'fail' });
      expect(useCustomFontStore.getState().getLoadedFonts()).toHaveLength(0);
    });
  });

  describe('isFontLoaded', () => {
    test('returns true for loaded font without error', () => {
      const font = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().updateFont(font.id, { loaded: true });
      expect(useCustomFontStore.getState().isFontLoaded(font.id)).toBe(true);
    });

    test('returns false for deleted font', () => {
      const font = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().updateFont(font.id, { loaded: true });
      useCustomFontStore.getState().removeFont(font.id);
      expect(useCustomFontStore.getState().isFontLoaded(font.id)).toBe(false);
    });

    test('returns false for font with error', () => {
      const font = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().updateFont(font.id, { loaded: true, error: 'err' });
      expect(useCustomFontStore.getState().isFontLoaded(font.id)).toBe(false);
    });

    test('returns false for unknown font', () => {
      expect(useCustomFontStore.getState().isFontLoaded('nope')).toBe(false);
    });
  });

  // ── loadFont ───────────────────────────────────────────────────
  describe('loadFont', () => {
    test('throws for non-existent font', async () => {
      const envConfig = createMockEnvConfig();
      await expect(
        useCustomFontStore.getState().loadFont(envConfig, 'nonexistent'),
      ).rejects.toThrow('not found');
    });

    test('throws for deleted font', async () => {
      const font = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().removeFont(font.id);
      const envConfig = createMockEnvConfig();
      await expect(useCustomFontStore.getState().loadFont(envConfig, font.id)).rejects.toThrow(
        'deleted',
      );
    });

    test('returns immediately if already loaded', async () => {
      const font = useCustomFontStore.getState().addFont('/a.ttf');
      useCustomFontStore.getState().updateFont(font.id, {
        loaded: true,
        blobUrl: 'blob:existing',
      });
      const envConfig = createMockEnvConfig();
      const result = await useCustomFontStore.getState().loadFont(envConfig, font.id);
      expect(result.blobUrl).toBe('blob:existing');
      expect(envConfig.getAppService).not.toHaveBeenCalled();
    });
  });

  // ── saveCustomFonts ────────────────────────────────────────────
  describe('saveCustomFonts', () => {
    test('saves fonts to settings store (strips blobUrl/loaded/error)', async () => {
      useCustomFontStore.getState().addFont('/fonts/Test.ttf');
      const font = useCustomFontStore.getState().fonts[0]!;
      useCustomFontStore.getState().updateFont(font.id, {
        loaded: true,
        blobUrl: 'blob:test',
      });

      const mockSetSettings = vi.fn();
      const mockSaveSettings = vi.fn();
      useSettingsStore.setState({
        settings: {} as SystemSettings,
        setSettings: mockSetSettings,
        saveSettings: mockSaveSettings,
      });

      const envConfig = createMockEnvConfig();
      await useCustomFontStore.getState().saveCustomFonts(envConfig);

      expect(mockSetSettings).toHaveBeenCalledTimes(1);
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);

      const savedSettings = mockSetSettings.mock.calls[0]![0] as SystemSettings;
      const savedFonts = savedSettings.customFonts;
      expect(savedFonts).toBeDefined();
      expect(savedFonts).toHaveLength(1);
      expect(savedFonts![0]).not.toHaveProperty('blobUrl');
      expect(savedFonts![0]).not.toHaveProperty('loaded');
      expect(savedFonts![0]).not.toHaveProperty('error');
    });
  });
});
