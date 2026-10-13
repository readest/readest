import { describe, expect, it } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import { getLockedPanX } from '@/app/reader/utils/lockedPan';

const view = (panX: number | null | undefined) => ({ renderer: { panX } }) as FoliateView;
const settings = (lockHorizontalPan: boolean) => ({ lockHorizontalPan }) as ViewSettings;

describe('getLockedPanX', () => {
  it('keeps where the locked page is panned, including its left edge', () => {
    expect(getLockedPanX(view(0.4), settings(true))).toBe(0.4);
    expect(getLockedPanX(view(0), settings(true))).toBe(0);
  });

  it('keeps nothing while the lock is off', () => {
    expect(getLockedPanX(view(0.4), settings(false))).toBeUndefined();
  });

  it('keeps nothing when the page does not overflow or the renderer has no pan', () => {
    expect(getLockedPanX(view(null), settings(true))).toBeUndefined();
    expect(getLockedPanX(view(undefined), settings(true))).toBeUndefined();
    expect(getLockedPanX(null, settings(true))).toBeUndefined();
  });
});
