import { describe, test, expect } from 'vitest';
import {
  normalizeNativeKey,
  normalizeDomKeyEvent,
  formatKeyBindingLabel,
  isModifierKeyEvent,
  matchesBinding,
  resolvePageTurn,
  isPencilNativeKey,
} from '@/utils/keybinding';
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

  test('records modifier combinations on the non-modifier key', () => {
    const event = {
      code: 'KeyD',
      key: 'd',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent;
    expect(normalizeDomKeyEvent(event)).toEqual({
      source: 'dom',
      id: 'KeyD',
      label: 'D',
      ctrlKey: true,
      shiftKey: true,
    });
  });

  test('translates each chord label independently', () => {
    expect(
      formatKeyBindingLabel(
        { source: 'dom', id: 'KeyD', label: 'D', ctrlKey: true, shiftKey: true },
        (value) => `[${value}]`,
      ),
    ).toBe('[Ctrl] + [Shift] + [D]');
  });

  test('keeps code-only iframe key messages compatible', () => {
    expect(normalizeDomKeyEvent({ code: 'ArrowRight' })).toEqual({
      source: 'dom',
      id: 'ArrowRight',
      label: 'Arrow Right',
    });
  });

  test('keeps a modifier-only key usable as a legacy main key', () => {
    const event = {
      code: 'ControlRight',
      key: 'Control',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent;
    expect(normalizeDomKeyEvent(event)).toEqual({
      source: 'dom',
      id: 'ControlRight',
      label: 'ControlRight',
    });
  });

  test('does not treat AltGraph synthetic Ctrl+Alt flags as a chord', () => {
    const event = {
      code: 'AltRight',
      key: 'AltGraph',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    } as KeyboardEvent;
    expect(normalizeDomKeyEvent(event)).toEqual({
      source: 'dom',
      id: 'AltRight',
      label: 'AltRight',
    });
  });

  test('keeps AltGraph chords distinct from Ctrl+Alt chords', () => {
    const altGraphChord = normalizeDomKeyEvent({
      code: 'KeyD',
      key: 'd',
      ctrlKey: true,
      altKey: true,
      getModifierState: (modifier) => modifier === 'AltGraph',
    });
    expect(altGraphChord).toEqual({
      source: 'dom',
      id: 'KeyD',
      label: 'D',
      altGraphKey: true,
    });
    expect(formatKeyBindingLabel(altGraphChord, (value) => value)).toBe('AltGraph + D');
    expect(
      matchesBinding(altGraphChord, {
        source: 'dom',
        id: 'KeyD',
        altGraphKey: true,
      }),
    ).toBe(true);
    expect(
      matchesBinding(altGraphChord, {
        source: 'dom',
        id: 'KeyD',
        ctrlKey: true,
        altKey: true,
      }),
    ).toBe(false);
  });
});

describe('isModifierKeyEvent', () => {
  test.each([
    ['Control', 'ControlRight'],
    ['Shift', 'ShiftLeft'],
    ['Alt', 'AltRight'],
    ['Meta', 'MetaLeft'],
    ['AltGraph', ''],
  ])('identifies %s as a modifier-only keydown', (key, code) => {
    expect(isModifierKeyEvent({ key, code } as KeyboardEvent)).toBe(true);
  });

  test('does not classify the completed chord key as modifier-only', () => {
    expect(isModifierKeyEvent({ key: 'ArrowRight', code: 'ArrowRight' } as KeyboardEvent)).toBe(
      false,
    );
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

  test('requires an exact modifier combination', () => {
    const combo = {
      source: 'dom' as const,
      id: 'ArrowRight',
      label: 'Ctrl + Arrow Right',
      ctrlKey: true,
    };

    expect(matchesBinding(combo, { source: 'dom', id: 'ArrowRight', ctrlKey: true })).toBe(true);
    expect(matchesBinding(combo, { source: 'dom', id: 'ArrowRight' })).toBe(false);
    expect(
      matchesBinding(combo, {
        source: 'dom',
        id: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe(false);
  });

  test('keeps legacy bindings without modifier fields matching plain keys only', () => {
    const legacy = { source: 'dom' as const, id: 'ArrowRight', label: 'Arrow Right' };

    expect(matchesBinding(legacy, { source: 'dom', id: 'ArrowRight' })).toBe(true);
    expect(matchesBinding(legacy, { source: 'dom', id: 'ArrowRight', ctrlKey: true })).toBe(false);
  });
});

describe('resolvePageTurn', () => {
  const settings: HardwarePageTurnerSettings = {
    enabled: true,
    bindings: {
      pagePrev: { source: 'native', id: 'MediaPrevious', label: 'Media Previous' },
      pageNext: { source: 'native', id: 'MediaNext', label: 'Media Next' },
      sectionPrev: { source: 'dom', id: 'PageUp', label: 'Page Up' },
      sectionNext: { source: 'dom', id: 'PageDown', label: 'Page Down' },
      refresh: { source: 'native', id: 'MediaPlayPause', label: 'Media Play/Pause' },
    },
  };

  test('returns "pagePrev" for the pagePrev binding', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaPrevious' })).toBe('pagePrev');
  });

  test('returns "pageNext" for the pageNext binding', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaNext' })).toBe('pageNext');
  });

  test('returns "sectionPrev" for the sectionPrev binding', () => {
    expect(resolvePageTurn(settings, { source: 'dom', id: 'PageUp' })).toBe('sectionPrev');
  });

  test('returns "sectionNext" for the sectionNext binding', () => {
    expect(resolvePageTurn(settings, { source: 'dom', id: 'PageDown' })).toBe('sectionNext');
  });

  test('returns "refresh" for the refresh binding', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaPlayPause' })).toBe('refresh');
  });

  test('returns null for an unbound key', () => {
    expect(resolvePageTurn(settings, { source: 'native', id: 'MediaFastForward' })).toBeNull();
  });

  test('returns null when the feature is disabled', () => {
    const disabled = { ...settings, enabled: false };
    expect(resolvePageTurn(disabled, { source: 'native', id: 'MediaNext' })).toBeNull();
  });
});

describe('Apple Pencil native keys (#5501)', () => {
  test('maps pencil gesture ids to friendly labels', () => {
    expect(normalizeNativeKey('PencilDoubleTap')).toEqual({
      source: 'native',
      id: 'PencilDoubleTap',
      label: 'Pencil Double Tap',
    });
    expect(normalizeNativeKey('PencilSqueeze')).toEqual({
      source: 'native',
      id: 'PencilSqueeze',
      label: 'Pencil Squeeze',
    });
  });

  test('isPencilNativeKey identifies pencil ids only', () => {
    expect(isPencilNativeKey('PencilDoubleTap')).toBe(true);
    expect(isPencilNativeKey('PencilSqueeze')).toBe(true);
    expect(isPencilNativeKey('MediaNext')).toBe(false);
    expect(isPencilNativeKey('VolumeUp')).toBe(false);
  });

  test('resolvePageTurn resolves bound pencil gestures', () => {
    const pencilSettings: HardwarePageTurnerSettings = {
      enabled: true,
      bindings: {
        pagePrev: { source: 'native', id: 'PencilSqueeze', label: 'Pencil Squeeze' },
        pageNext: { source: 'native', id: 'PencilDoubleTap', label: 'Pencil Double Tap' },
        sectionPrev: null,
        sectionNext: null,
        refresh: null,
      },
    };
    expect(resolvePageTurn(pencilSettings, { source: 'native', id: 'PencilDoubleTap' })).toBe(
      'pageNext',
    );
    expect(resolvePageTurn(pencilSettings, { source: 'native', id: 'PencilSqueeze' })).toBe(
      'pagePrev',
    );
  });
});
