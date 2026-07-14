import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import {
  decideRemoteConflict,
  resolveRemoteLocalFraction,
  type RemoteFractionResolution,
} from '@/app/reader/hooks/kosyncProgress';
import { getCFIFromXPointer } from '@/utils/xcfi';

// Only the wiring matters here; XPointer↔CFI accuracy is covered elsewhere.
vi.mock('@/utils/xcfi', () => ({
  getCFIFromXPointer: vi.fn(),
}));

const mockGetCFIFromXPointer = vi.mocked(getCFIFromXPointer);

const XPOINTER = '/body/DocFragment[326]/body/div/p[3]/text().0';

const makeView = (fraction: number | null | undefined): FoliateView =>
  ({
    renderer: { primaryIndex: 0, getContents: () => [] },
    getCFIProgress: vi.fn().mockResolvedValue(fraction == null ? fraction : { fraction }),
  }) as unknown as FoliateView;

const bookDoc = {} as BookDoc;

describe('resolveRemoteLocalFraction', () => {
  beforeEach(() => mockGetCFIFromXPointer.mockReset());

  it('reports a resolved local fraction for a convertible XPointer', async () => {
    mockGetCFIFromXPointer.mockResolvedValue('epubcfi(/6/8!/4/2/6)');
    const res = await resolveRemoteLocalFraction(
      { progress: XPOINTER, percentage: 0.99 },
      makeView(0.42),
      bookDoc,
    );
    expect(res).toEqual({ status: 'resolved', fraction: 0.42 });
  });

  it('reports "unresolved" when resolving the XPointer fails', async () => {
    // Simulate a conversion failure (common on iOS): the renderer throws while
    // the converter reaches for the current section. The catch must classify
    // this as 'unresolved', never as "no conflict".
    mockGetCFIFromXPointer.mockResolvedValue('epubcfi(/6/8!/4/2/6)');
    const brokenView = {
      renderer: {
        primaryIndex: 0,
        getContents: () => {
          throw new Error('renderer unavailable (iOS)');
        },
      },
      getCFIProgress: vi.fn(),
    } as unknown as FoliateView;

    const res = await resolveRemoteLocalFraction({ progress: XPOINTER }, brokenView, bookDoc);
    expect(res).toEqual({ status: 'unresolved' });
  });

  it('reports "unresolved" when the CFI maps to no local progress', async () => {
    mockGetCFIFromXPointer.mockResolvedValue('epubcfi(/99/999!/0)');
    const res = await resolveRemoteLocalFraction({ progress: XPOINTER }, makeView(null), bookDoc);
    expect(res).toEqual({ status: 'unresolved' });
  });

  it('reports "not-xpointer" for non-KOReader progress without converting', async () => {
    const res = await resolveRemoteLocalFraction(
      { progress: 'page-42', percentage: 0.5 },
      makeView(0.42),
      bookDoc,
    );
    expect(res).toEqual({ status: 'not-xpointer' });
    expect(mockGetCFIFromXPointer).not.toHaveBeenCalled();
  });
});

describe('decideRemoteConflict', () => {
  const threshold = 0.0001;

  it('flags a conflict when a resolved remote position is meaningfully ahead', () => {
    const resolution: RemoteFractionResolution = { status: 'resolved', fraction: 0.6 };
    const decision = decideRemoteConflict(resolution, 0.14, 0.14, threshold);
    // The local fraction — not KOReader's percentage — drives the comparison.
    expect(decision).toEqual({ showConflictDetails: true, comparePercentage: 0.6 });
  });

  it('reports no conflict when a resolved remote position matches locally', () => {
    const resolution: RemoteFractionResolution = { status: 'resolved', fraction: 0.14 };
    const decision = decideRemoteConflict(resolution, 0.14, 0.99, threshold);
    expect(decision.showConflictDetails).toBe(false);
    // Proves KOReader's (incomparable) 0.99 percentage is NOT assimilated.
    expect(decision.comparePercentage).toBe(0.14);
  });

  it('ALWAYS flags a conflict for an unresolved XPointer, even when the percentages match (#5065)', () => {
    // This is the core regression: KOReader's percentage happening to equal
    // Readest's must never be read as "no conflict" when the position could
    // not be resolved. Before the fix this returned false → the remote
    // position was silently dropped and auto-push clobbered it.
    const resolution: RemoteFractionResolution = { status: 'unresolved' };
    const decision = decideRemoteConflict(resolution, 0.1393, 0.1393, threshold);
    expect(decision.showConflictDetails).toBe(true);
  });

  it('falls back to the reported percentage only for non-XPointer servers', () => {
    const resolution: RemoteFractionResolution = { status: 'not-xpointer' };
    expect(decideRemoteConflict(resolution, 0.14, 0.14, threshold)).toEqual({
      showConflictDetails: false,
      comparePercentage: 0.14,
    });
    expect(decideRemoteConflict(resolution, 0.14, 0.9, threshold)).toEqual({
      showConflictDetails: true,
      comparePercentage: 0.9,
    });
  });
});
