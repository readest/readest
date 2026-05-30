import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { getRemoteLocalFraction } from '@/app/reader/hooks/kosyncProgress';
import { getCFIFromXPointer } from '@/utils/xcfi';

// The XPointer↔CFI conversion accuracy is covered by the xcfi and
// page-progress-epub suites; here we only exercise how the helper wires the
// conversion, the fraction lookup, and its fallbacks.
vi.mock('@/utils/xcfi', () => ({
  getCFIFromXPointer: vi.fn(),
}));

const mockGetCFIFromXPointer = vi.mocked(getCFIFromXPointer);

const XPOINTER = '/body/DocFragment[4]/body/div/p[3]/text().0';

const makeView = (fraction: number | null): FoliateView =>
  ({
    renderer: { primaryIndex: 0, getContents: () => [] },
    getCFIProgress: vi.fn().mockResolvedValue(fraction === null ? null : { fraction }),
  }) as unknown as FoliateView;

const bookDoc = {} as BookDoc;

describe('getRemoteLocalFraction', () => {
  beforeEach(() => {
    mockGetCFIFromXPointer.mockReset();
  });

  it('resolves an XPointer position to the local book fraction (not the reported percentage)', async () => {
    mockGetCFIFromXPointer.mockResolvedValue('epubcfi(/6/8!/4/2/6)');
    const view = makeView(0.42);

    // percentage deliberately wrong to prove the local fraction is used instead
    const remote = { progress: XPOINTER, percentage: 0.99 };
    const fraction = await getRemoteLocalFraction(remote, view, bookDoc);

    expect(fraction).toBe(0.42);
    expect(mockGetCFIFromXPointer).toHaveBeenCalledOnce();
    expect(view.getCFIProgress).toHaveBeenCalledWith('epubcfi(/6/8!/4/2/6)');
  });

  it('returns undefined for non-XPointer progress without attempting conversion', async () => {
    const view = makeView(0.42);

    expect(
      await getRemoteLocalFraction({ progress: '42', percentage: 0.5 }, view, bookDoc),
    ).toBeUndefined();
    expect(await getRemoteLocalFraction({ progress: undefined }, view, bookDoc)).toBeUndefined();
    expect(mockGetCFIFromXPointer).not.toHaveBeenCalled();
  });

  it('returns undefined when the XPointer cannot be converted to a local CFI', async () => {
    mockGetCFIFromXPointer.mockRejectedValue(new Error('section not found'));
    const view = makeView(0.42);

    expect(await getRemoteLocalFraction({ progress: XPOINTER }, view, bookDoc)).toBeUndefined();
  });

  it('returns undefined when the CFI resolves to no local progress', async () => {
    mockGetCFIFromXPointer.mockResolvedValue('epubcfi(/99/999!/0)');
    const view = makeView(null);

    expect(await getRemoteLocalFraction({ progress: XPOINTER }, view, bookDoc)).toBeUndefined();
  });
});
