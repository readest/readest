// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import type { GrimmorySettings } from '@/types/settings';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));

import { isPassEnabled } from '@/app/reader/hooks/useGrimmoryNotesSync';

const connected = {
  enabled: true,
  serverUrl: 'https://grimmory.example',
  username: 'reader',
  password: 'secret',
  syncProgress: false,
  syncNotes: false,
  syncStats: false,
  syncBookStates: false,
} as GrimmorySettings;

describe('isPassEnabled', () => {
  test('runs for reading statistics alone, which need the book matched', () => {
    expect(isPassEnabled({ ...connected, syncStats: true })).toBe(true);
  });

  test('stays off when nothing it serves is on, or when not connected', () => {
    expect(isPassEnabled(connected)).toBe(false);
    expect(isPassEnabled({ ...connected, syncProgress: true })).toBe(false);
    expect(isPassEnabled({ ...connected, syncStats: true, password: '' })).toBe(false);
  });
});
