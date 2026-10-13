import { describe, expect, it } from 'vitest';
import { useThemeStore } from '@/store/themeStore';

describe('themeStore iPhone Duo flag', () => {
  it('defaults to false, so every other device keeps its behaviour', () => {
    expect(useThemeStore.getState().isIPhoneDuo).toBe(false);
  });

  it('is set through setIsIPhoneDuo', () => {
    useThemeStore.getState().setIsIPhoneDuo(true);
    expect(useThemeStore.getState().isIPhoneDuo).toBe(true);
    useThemeStore.getState().setIsIPhoneDuo(false);
    expect(useThemeStore.getState().isIPhoneDuo).toBe(false);
  });
});
