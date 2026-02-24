import { BookProgress } from '@/types/book';

const toSeconds = (minutes?: number) => {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return null;
  return Math.round(minutes * 60);
};

const getSafeRate = (rate?: number) => {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
};

const applyRate = (seconds: number | null, rate: number) => {
  if (seconds === null) return null;
  return Math.max(0, Math.round(seconds / rate));
};

export type TTSTimeEstimate = {
  chapterRemainingSec: number | null;
  bookRemainingSec: number | null;
  finishAtTimestamp: number | null;
};

export const estimateTTSTime = (
  progress: BookProgress | null,
  rate?: number,
  now = Date.now(),
): TTSTimeEstimate => {
  const safeRate = getSafeRate(rate);
  const chapterRemainingBaseSec = toSeconds(progress?.timeinfo?.section);
  const bookRemainingBaseSec = toSeconds(progress?.timeinfo?.total);

  const chapterRemainingSec = applyRate(chapterRemainingBaseSec, safeRate);
  const bookRemainingSec = applyRate(bookRemainingBaseSec, safeRate);

  const finishAtTimestamp =
    bookRemainingSec !== null && bookRemainingSec > 0 ? now + bookRemainingSec * 1000 : null;

  return {
    chapterRemainingSec,
    bookRemainingSec,
    finishAtTimestamp,
  };
};
