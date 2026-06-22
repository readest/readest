import { describe, it, expect } from 'vitest';
import { getKeyboardSelectionAdjustment } from '@/utils/sel';

describe('getKeyboardSelectionAdjustment', () => {
  it('maps Shift+ArrowRight to a forward character extension', () => {
    expect(getKeyboardSelectionAdjustment({ key: 'ArrowRight', shiftKey: true })).toEqual({
      direction: 'right',
      granularity: 'character',
    });
  });

  it('maps Shift+ArrowLeft to a backward character extension', () => {
    expect(getKeyboardSelectionAdjustment({ key: 'ArrowLeft', shiftKey: true })).toEqual({
      direction: 'left',
      granularity: 'character',
    });
  });

  it('treats Ctrl+Shift+Arrow as a word extension (Windows/Linux)', () => {
    expect(
      getKeyboardSelectionAdjustment({ key: 'ArrowRight', shiftKey: true, ctrlKey: true }),
    ).toEqual({ direction: 'right', granularity: 'word' });
    expect(
      getKeyboardSelectionAdjustment({ key: 'ArrowLeft', shiftKey: true, ctrlKey: true }),
    ).toEqual({ direction: 'left', granularity: 'word' });
  });

  it('treats Alt/Option+Shift+Arrow as a word extension (macOS)', () => {
    expect(
      getKeyboardSelectionAdjustment({ key: 'ArrowRight', shiftKey: true, altKey: true }),
    ).toEqual({ direction: 'right', granularity: 'word' });
  });

  it('returns null without the Shift modifier', () => {
    expect(getKeyboardSelectionAdjustment({ key: 'ArrowRight' })).toBeNull();
    expect(getKeyboardSelectionAdjustment({ key: 'ArrowLeft', ctrlKey: true })).toBeNull();
  });

  it('returns null when the Meta/Cmd key is held (reserved for line-boundary selection)', () => {
    expect(
      getKeyboardSelectionAdjustment({ key: 'ArrowRight', shiftKey: true, metaKey: true }),
    ).toBeNull();
  });

  it('ignores non-horizontal arrows and other keys', () => {
    expect(getKeyboardSelectionAdjustment({ key: 'ArrowUp', shiftKey: true })).toBeNull();
    expect(getKeyboardSelectionAdjustment({ key: 'ArrowDown', shiftKey: true })).toBeNull();
    expect(getKeyboardSelectionAdjustment({ key: 'a', shiftKey: true })).toBeNull();
  });
});
