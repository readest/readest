import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { XRayService } from '@/services/ai/xray/XRayService';
import type { AppService } from '@/types/system';

const enabledSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  reedy: { enabled: true },
};

describe('XRayService', () => {
  it('rejects non-Tauri callers before opening a database', async () => {
    const openDatabase = vi.fn();
    const appService = {
      appPlatform: 'web',
      openDatabase,
    } as unknown as AppService;

    await expect(XRayService.open(appService, enabledSettings)).rejects.toThrow(
      'X-Ray is only available in the Tauri app',
    );
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it.each([
    ['AI', { ...enabledSettings, enabled: false }],
    ['Reedy', { ...enabledSettings, reedy: { enabled: false } }],
  ])('rejects when %s is disabled before opening a database', async (_feature, settings) => {
    const openDatabase = vi.fn().mockRejectedValue(new Error('database opened'));
    const appService = {
      appPlatform: 'tauri',
      databaseExists: vi.fn().mockResolvedValue(false),
      openDatabase,
    } as unknown as AppService;

    await expect(XRayService.open(appService, settings)).rejects.toThrow(
      'X-Ray requires AI and Reedy to be enabled',
    );
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
