import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { XRayService } from '@/services/ai/xray/XRayService';
import type { AppService } from '@/types/system';

describe('XRayService', () => {
  it('rejects non-Tauri callers before opening a database', async () => {
    const openDatabase = vi.fn();
    const appService = {
      appPlatform: 'web',
      openDatabase,
    } as unknown as AppService;

    await expect(XRayService.open(appService, DEFAULT_AI_SETTINGS)).rejects.toThrow(
      'X-Ray is only available in the Tauri app',
    );
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
