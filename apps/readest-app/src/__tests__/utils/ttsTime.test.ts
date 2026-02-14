import { describe, expect, it } from 'vitest';
import { estimateTTSTime } from '@/utils/ttsTime';
import { BookProgress } from '@/types/book';

const createProgress = (values: {
  sectionMin: number;
  totalMin: number;
  pageCurrent: number;
  pageTotal: number;
}) => {
  return {
    timeinfo: {
      section: values.sectionMin,
      total: values.totalMin,
    },
    pageinfo: {
      current: values.pageCurrent,
      total: values.pageTotal,
    },
  } as BookProgress;
};

describe('estimateTTSTime', () => {
  it('estimates chapter and book remaining time at 1x', () => {
    const progress = createProgress({ sectionMin: 10, totalMin: 60, pageCurrent: 49, pageTotal: 100 });

    const result = estimateTTSTime(progress, 1, 1_700_000_000_000);

    expect(result.chapterRemainingSec).toBe(600);
    expect(result.bookRemainingSec).toBe(3600);
    expect(result.finishAtTimestamp).toBe(1_700_003_600_000);
  });

  it('scales estimates by playback rate', () => {
    const progress = createProgress({ sectionMin: 12, totalMin: 90, pageCurrent: 44, pageTotal: 90 });

    const result = estimateTTSTime(progress, 1.5, 1000);

    expect(result.chapterRemainingSec).toBe(480);
    expect(result.bookRemainingSec).toBe(3600);
    expect(result.finishAtTimestamp).toBe(3_601_000);
  });

  it('falls back safely for missing progress', () => {
    const result = estimateTTSTime(null, 2, 1000);

    expect(result.chapterRemainingSec).toBeNull();
    expect(result.bookRemainingSec).toBeNull();
    expect(result.finishAtTimestamp).toBeNull();
  });

  it('uses book remaining to compute finish time', () => {
    const progress = createProgress({ sectionMin: 1, totalMin: 2, pageCurrent: 99, pageTotal: 100 });

    const result = estimateTTSTime(progress, 1, 1000);

    expect(result.bookRemainingSec).toBe(120);
    expect(result.finishAtTimestamp).toBe(121000);
  });
});
