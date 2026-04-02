import { describe, test, expect, beforeEach } from 'vitest';
import { TTSUtils } from '@/services/tts/TTSUtils';

describe('TTSUtils', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('setPreferredClient / getPreferredClient', () => {
    test('returns null when no client set', () => {
      expect(TTSUtils.getPreferredClient()).toBeNull();
    });

    test('stores and retrieves preferred client', () => {
      TTSUtils.setPreferredClient('edge');
      expect(TTSUtils.getPreferredClient()).toBe('edge');
    });

    test('overwrites previous client', () => {
      TTSUtils.setPreferredClient('edge');
      TTSUtils.setPreferredClient('web');
      expect(TTSUtils.getPreferredClient()).toBe('web');
    });

    test('does nothing for empty engine', () => {
      TTSUtils.setPreferredClient('');
      expect(TTSUtils.getPreferredClient()).toBeNull();
    });
  });

  describe('setPreferredVoice / getPreferredVoice', () => {
    test('returns null when no voice set', () => {
      expect(TTSUtils.getPreferredVoice('edge', 'en')).toBeNull();
    });

    test('stores and retrieves preferred voice', () => {
      TTSUtils.setPreferredVoice('edge', 'en-US', 'voice-1');
      expect(TTSUtils.getPreferredVoice('edge', 'en-US')).toBe('voice-1');
    });

    test('normalizes language to two-letter code', () => {
      TTSUtils.setPreferredVoice('edge', 'en-US', 'voice-1');
      // Retrieve with different regional code should match
      expect(TTSUtils.getPreferredVoice('edge', 'en-GB')).toBe('voice-1');
    });

    test('stores voices per engine independently', () => {
      TTSUtils.setPreferredVoice('edge', 'en', 'edge-v');
      TTSUtils.setPreferredVoice('web', 'en', 'web-v');
      expect(TTSUtils.getPreferredVoice('edge', 'en')).toBe('edge-v');
      expect(TTSUtils.getPreferredVoice('web', 'en')).toBe('web-v');
    });

    test('does nothing for empty engine', () => {
      TTSUtils.setPreferredVoice('', 'en', 'v');
      expect(TTSUtils.getPreferredVoice('', 'en')).toBeNull();
    });

    test('does nothing for empty language', () => {
      TTSUtils.setPreferredVoice('edge', '', 'v');
      expect(TTSUtils.getPreferredVoice('edge', '')).toBeNull();
    });

    test('does nothing for empty voiceId', () => {
      TTSUtils.setPreferredVoice('edge', 'en', '');
      expect(TTSUtils.getPreferredVoice('edge', 'en')).toBeNull();
    });

    test('normalizes empty language to n/a', () => {
      // Internal: normalizeLanguage('') => 'n/a'
      // Calling getPreferredVoice with empty lang should check 'n/a' key
      TTSUtils.setPreferredVoice('edge', 'en', 'v1');
      expect(TTSUtils.getPreferredVoice('edge', '')).toBeNull();
    });
  });

  describe('sortVoicesFunc', () => {
    test('sorts CN region first', () => {
      const a = { id: '1', name: 'A', lang: 'zh-CN' };
      const b = { id: '2', name: 'B', lang: 'zh-TW' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('sorts TW region before HK', () => {
      const a = { id: '1', name: 'A', lang: 'zh-TW' };
      const b = { id: '2', name: 'B', lang: 'zh-HK' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('sorts HK region before US', () => {
      const a = { id: '1', name: 'A', lang: 'zh-HK' };
      const b = { id: '2', name: 'B', lang: 'en-US' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('sorts US region before GB', () => {
      const a = { id: '1', name: 'A', lang: 'en-US' };
      const b = { id: '2', name: 'B', lang: 'en-GB' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('sorts GB region before other', () => {
      const a = { id: '1', name: 'A', lang: 'en-GB' };
      const b = { id: '2', name: 'B', lang: 'en-AU' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('sorts by name when same region', () => {
      const a = { id: '1', name: 'Alpha', lang: 'en-US' };
      const b = { id: '2', name: 'Beta', lang: 'en-US' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('returns 0 for identical names and regions', () => {
      const a = { id: '1', name: 'Same', lang: 'en-US' };
      const b = { id: '2', name: 'Same', lang: 'en-US' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(0);
    });

    test('sorts by name when no region', () => {
      const a = { id: '1', name: 'Alpha', lang: 'en' };
      const b = { id: '2', name: 'Beta', lang: 'en' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('returns 1 when b name comes before a name in same region', () => {
      const a = { id: '1', name: 'Zeta', lang: 'en-US' };
      const b = { id: '2', name: 'Alpha', lang: 'en-US' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(1);
    });

    test('sorts by name for non-special regions', () => {
      const a = { id: '1', name: 'Alpha', lang: 'en-AU' };
      const b = { id: '2', name: 'Beta', lang: 'en-NZ' };
      expect(TTSUtils.sortVoicesFunc(a, b)).toBe(-1);
    });

    test('CN beats everything', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'Z', lang: 'zh-CN' },
          { id: '2', name: 'A', lang: 'en-US' },
        ),
      ).toBe(-1);
    });

    test('US beats non-special regions from b side', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'A', lang: 'en-AU' },
          { id: '2', name: 'B', lang: 'en-US' },
        ),
      ).toBe(1);
    });

    test('GB beats non-special from a side', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'A', lang: 'en-GB' },
          { id: '2', name: 'B', lang: 'en-AU' },
        ),
      ).toBe(-1);
    });

    test('b is CN, a is not', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'A', lang: 'en-US' },
          { id: '2', name: 'B', lang: 'zh-CN' },
        ),
      ).toBe(1);
    });

    test('b is TW, a is not CN', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'A', lang: 'en-US' },
          { id: '2', name: 'B', lang: 'zh-TW' },
        ),
      ).toBe(1);
    });

    test('b is HK, a is not CN/TW', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'A', lang: 'en-US' },
          { id: '2', name: 'B', lang: 'zh-HK' },
        ),
      ).toBe(1);
    });

    test('b is GB, a is not CN/TW/HK/US', () => {
      expect(
        TTSUtils.sortVoicesFunc(
          { id: '1', name: 'A', lang: 'en-AU' },
          { id: '2', name: 'B', lang: 'en-GB' },
        ),
      ).toBe(1);
    });
  });

  describe('persistence', () => {
    test('preferences survive across calls', () => {
      TTSUtils.setPreferredClient('edge');
      TTSUtils.setPreferredVoice('edge', 'en', 'v1');
      TTSUtils.setPreferredVoice('web', 'fr', 'v2');

      expect(TTSUtils.getPreferredClient()).toBe('edge');
      expect(TTSUtils.getPreferredVoice('edge', 'en')).toBe('v1');
      expect(TTSUtils.getPreferredVoice('web', 'fr')).toBe('v2');
    });
  });
});
