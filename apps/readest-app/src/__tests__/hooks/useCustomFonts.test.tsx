import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const loadCustomFontsSpy = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

let envValue: { envConfig: unknown; appService: unknown } = {
  envConfig: { name: 'env' },
  appService: { name: 'svc' },
};
let settingsValue: { settings: { customFonts?: unknown[] } } = {
  settings: { customFonts: [] },
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => envValue,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => settingsValue,
}));

vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ loadCustomFonts: loadCustomFontsSpy }),
}));

import { useCustomFonts } from '@/hooks/useCustomFonts';

beforeEach(() => {
  loadCustomFontsSpy.mockClear();
  envValue = { envConfig: { name: 'env' }, appService: { name: 'svc' } };
  settingsValue = { settings: { customFonts: [] } };
});

afterEach(() => {
  cleanup();
});

describe('useCustomFonts', () => {
  test('hydrates the custom font store on mount', () => {
    renderHook(() => useCustomFonts());
    expect(loadCustomFontsSpy).toHaveBeenCalledTimes(1);
    expect(loadCustomFontsSpy).toHaveBeenCalledWith(envValue.envConfig);
  });

  test('waits for the app service before hydrating', () => {
    envValue = { envConfig: { name: 'env' }, appService: null };
    renderHook(() => useCustomFonts());
    expect(loadCustomFontsSpy).not.toHaveBeenCalled();
  });

  test('skips hydration when settings carry no customFonts field', () => {
    settingsValue = { settings: {} };
    renderHook(() => useCustomFonts());
    expect(loadCustomFontsSpy).not.toHaveBeenCalled();
  });
});
