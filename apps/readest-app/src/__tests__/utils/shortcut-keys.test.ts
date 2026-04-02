import { describe, it, expect } from 'vitest';
import { formatKeyForDisplay, filterPlatformKeys } from '../../utils/shortcutKeys';

describe('formatKeyForDisplay', () => {
  describe('Mac platform', () => {
    it('maps ctrl to ⌘', () => {
      expect(formatKeyForDisplay('ctrl+f', true)).toBe('⌘F');
    });

    it('maps cmd to ⌘', () => {
      expect(formatKeyForDisplay('cmd+f', true)).toBe('⌘F');
    });

    it('maps alt/opt to ⌥', () => {
      expect(formatKeyForDisplay('alt+ArrowLeft', true)).toBe('⌥←');
      expect(formatKeyForDisplay('opt+ArrowLeft', true)).toBe('⌥←');
    });

    it('maps shift to ⇧', () => {
      expect(formatKeyForDisplay('shift+j', true)).toBe('⇧J');
    });

    it('concatenates without separator on Mac', () => {
      expect(formatKeyForDisplay('cmd+shift+p', true)).toBe('⌘⇧P');
    });
  });

  describe('non-Mac platform', () => {
    it('maps ctrl to Ctrl', () => {
      expect(formatKeyForDisplay('ctrl+f', false)).toBe('Ctrl+F');
    });

    it('maps alt to Alt', () => {
      expect(formatKeyForDisplay('alt+ArrowLeft', false)).toBe('Alt+←');
    });

    it('maps shift to Shift', () => {
      expect(formatKeyForDisplay('shift+j', false)).toBe('Shift+J');
    });

    it('joins with + on non-Mac', () => {
      expect(formatKeyForDisplay('ctrl+shift+p', false)).toBe('Ctrl+Shift+P');
    });
  });

  describe('special keys', () => {
    it('maps arrow keys to symbols', () => {
      expect(formatKeyForDisplay('ArrowLeft', false)).toBe('←');
      expect(formatKeyForDisplay('ArrowRight', false)).toBe('→');
      expect(formatKeyForDisplay('ArrowUp', false)).toBe('↑');
      expect(formatKeyForDisplay('ArrowDown', false)).toBe('↓');
    });

    it('maps space to Space', () => {
      expect(formatKeyForDisplay(' ', false)).toBe('Space');
    });

    it('maps Escape to Esc', () => {
      expect(formatKeyForDisplay('Escape', false)).toBe('Esc');
    });

    it('maps PageDown and PageUp', () => {
      expect(formatKeyForDisplay('PageDown', false)).toBe('PgDn');
      expect(formatKeyForDisplay('PageUp', false)).toBe('PgUp');
    });

    it('preserves F-keys', () => {
      expect(formatKeyForDisplay('F11', false)).toBe('F11');
    });

    it('preserves Tab and Enter', () => {
      expect(formatKeyForDisplay('Tab', false)).toBe('Tab');
      expect(formatKeyForDisplay('Enter', false)).toBe('Enter');
    });
  });

  describe('single character keys', () => {
    it('capitalizes single letter keys', () => {
      expect(formatKeyForDisplay('s', false)).toBe('S');
      expect(formatKeyForDisplay('s', true)).toBe('S');
    });

    it('preserves special characters', () => {
      expect(formatKeyForDisplay(']', false)).toBe(']');
      expect(formatKeyForDisplay('[', false)).toBe('[');
    });
  });
});

describe('filterPlatformKeys', () => {
  it('on Mac, prefers cmd/opt keys over ctrl/alt', () => {
    expect(filterPlatformKeys(['ctrl+f', 'cmd+f'], true)).toEqual(['cmd+f']);
  });

  it('on non-Mac, prefers ctrl/alt keys over cmd/opt', () => {
    expect(filterPlatformKeys(['ctrl+f', 'cmd+f'], false)).toEqual(['ctrl+f']);
  });

  it('includes platform-agnostic keys on both platforms', () => {
    expect(filterPlatformKeys(['s'], true)).toEqual(['s']);
    expect(filterPlatformKeys(['s'], false)).toEqual(['s']);
  });

  it('on Mac, prefers opt over alt', () => {
    expect(filterPlatformKeys(['opt+ArrowLeft', 'alt+ArrowLeft'], true)).toEqual(['opt+ArrowLeft']);
  });

  it('on non-Mac, prefers alt over opt', () => {
    expect(filterPlatformKeys(['opt+ArrowLeft', 'alt+ArrowLeft'], false)).toEqual([
      'alt+ArrowLeft',
    ]);
  });

  it('returns all keys when none are platform-specific', () => {
    expect(filterPlatformKeys(['ArrowLeft', 'h', 'shift+ '], true)).toEqual([
      'ArrowLeft',
      'h',
      'shift+ ',
    ]);
  });

  it('mixes platform-specific and agnostic keys', () => {
    expect(filterPlatformKeys(['shift+f', 'ctrl+,', 'cmd+,'], true)).toEqual(['shift+f', 'cmd+,']);
    expect(filterPlatformKeys(['shift+f', 'ctrl+,', 'cmd+,'], false)).toEqual([
      'shift+f',
      'ctrl+,',
    ]);
  });
});
