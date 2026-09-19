import { describe, it, expect } from 'vitest';
import type { Rect } from '@/utils/sel';
import { insetRect } from '@/utils/sel';
import type { Insets } from '@/types/misc';

const zeroInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('insetRect', () => {
  it('is a no-op with zero insets', () => {
    const rect: Rect = { left: 0, top: 0, right: 1000, bottom: 800 };
    expect(insetRect(rect, zeroInsets)).toEqual(rect);
  });

  it('shrinks each edge by its matching inset', () => {
    const rect: Rect = { left: 0, top: 0, right: 1000, bottom: 800 };
    const insets: Insets = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(insetRect(rect, insets)).toEqual({ left: 40, top: 10, right: 980, bottom: 770 });
  });

  it('mirrors the iPhone Duo case: a large right inset, others zero (#6307)', () => {
    const rect: Rect = { left: 0, top: 0, right: 951, bottom: 669 };
    const insets: Insets = { top: 0, right: 190, bottom: 0, left: 0 };
    expect(insetRect(rect, insets)).toEqual({ left: 0, top: 0, right: 761, bottom: 669 });
  });

  it('clamps so the rect never inverts when insets exceed the rect size', () => {
    const rect: Rect = { left: 0, top: 0, right: 100, bottom: 100 };
    const insets: Insets = { top: 0, right: 1000, bottom: 0, left: 0 };
    const result = insetRect(rect, insets);
    expect(result.right).toBeGreaterThanOrEqual(result.left);
  });
});
