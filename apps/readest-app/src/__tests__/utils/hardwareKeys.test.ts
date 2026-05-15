import { describe, test, expect } from 'vitest';
import {
  normalizeNativeKey,
  normalizeDomKeyEvent,
  matchesBinding,
  resolvePageTurn,
} from '@/utils/hardwareKeys';
import { HardwarePageTurnerSettings } from '@/types/settings';

describe('normalizeNativeKey', () => {
  test('maps a known native key to a friendly label', () => {
    expect(normalizeNativeKey('MediaNext')).toEqual({
      source: 'native',
      id: 'MediaNext',
      label: 'Media Next',
    });
  });

  test('falls back to the raw id for an unknown native key', () => {
    expect(normalizeNativeKey('Keycode99')).toEqual({
      source: 'native',
      id: 'Keycode99',
      label: 'Keycode99',
    });
  });
});

describe('normalizeDomKeyEvent', () => {
  test('uses event.code and a friendly label for a known key', () => {
    const event = { code: 'ArrowLeft', key: 'ArrowLeft' } as KeyboardEvent;
    expect(normalizeDomKeyEvent(event)).toEqual({
      source: 'dom',
      id: 'ArrowLeft',
      label: 'Arrow Left',
    });
  });

  test('falls back to event.key when event.code is empty', () => {
    const event = { code: '', key: 'MediaTrackNext' } as KeyboardEvent;
    expect(normalizeDomKeyEvent(event)).toEqual({
      source: 'dom',
      id: 'MediaTrackNext',
      label: 'Media Next',
    });
  });
});

describe('matchesBinding', () => {
  const binding = { source: 'native' as const, id: 'MediaNext', label: 'Media Next' };

  test('matches same source and id', () => {
    expect(matchesBinding(binding, { source: 'native', id: 'MediaNext' })).toBe(true);
  });

  test('rejects different id', () => {
    expect(matchesBinding(binding, { source: 'native', id: 'MediaPrevious' })).toBe(false);
  });

  test('rejects different source', () => {
    expect(matchesBinding(binding, { source: 'dom', id: 'MediaNext' })).toBe(false);
  });

  test('rejects a null binding', () => {
    expect(matchesBinding(null, { source: 'native', id: 'MediaNext' })).toBe(false);
  });
});

describe('resolvePageTurn', () => {
  const settings: HardwarePageTurnerSettings = {
    enabled: true,
    bindings: {
      pagePrev: { source: 'native', id: 'MediaPrevious', label: 'Media Previous' },
      pageNext: { source: 'native', id: 'MediaNext', label: 'Media Next' },
    },
  };

  test('returns "prev" for the pagePrev binding', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaPrevious' })).toBe('prev');
  });

  test('returns "next" for the pageNext binding', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaNext' })).toBe('next');
  });

  test('returns null for an unbound key', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaPlayPause' })).toBeNull();
  });

  test('returns null when the feature is disabled', () => {
    const disabled = { ...settings, enabled: false };
    expect(resolvePageTurn(disabled, { source: 'native', id: 'MediaNext' })).toBeNull();
  });
});
