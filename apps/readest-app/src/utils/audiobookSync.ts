import { AudiobookSyncMapEntry, AudiobookSyncPoint } from '@/types/book';

/**
 * Filters invalid sync points, sorts ascending by time, and de-dupes exact
 * duplicate (time + cfi) pairs.
 */
export function normalizeAudiobookSyncPoints(
  points: AudiobookSyncPoint[] | undefined,
): AudiobookSyncPoint[] {
  if (!points || points.length === 0) return [];

  const valid = points.filter(
    (p) =>
      typeof p.time === 'number' &&
      Number.isFinite(p.time) &&
      p.time >= 0 &&
      typeof p.cfi === 'string' &&
      p.cfi.length > 0,
  );

  valid.sort((a, b) => a.time - b.time);

  const seen = new Set<string>();
  return valid.filter((p) => {
    const key = `${p.time}|${p.cfi}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface BuildSyncMapOptions {
  duration?: number;
}

/**
 * Converts normalized sync points into a sorted sync map with time ranges.
 *
 * - `secondsStart` = point.time
 * - `secondsEnd` = next point.time (when available)
 * - For the final point, `secondsEnd` = `duration` if provided and > start
 * - `source` defaults to `'manual-point'`
 */
export function buildSyncMapFromPoints(
  points: AudiobookSyncPoint[] | undefined,
  options?: BuildSyncMapOptions,
): AudiobookSyncMapEntry[] {
  const normalized = normalizeAudiobookSyncPoints(points);
  if (normalized.length === 0) return [];

  const duration = options?.duration;
  const entries: AudiobookSyncMapEntry[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const point = normalized[i]!;
    const nextPoint = normalized[i + 1];

    const entry: AudiobookSyncMapEntry = {
      secondsStart: point.time,
      cfi: point.cfi,
      label: point.label,
      source: 'manual-point',
    };

    if (nextPoint) {
      entry.secondsEnd = nextPoint.time;
    } else if (duration !== undefined && Number.isFinite(duration) && duration > point.time) {
      entry.secondsEnd = duration;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Fills time gaps between consecutive sync map entries with placeholder
 * entries so every moment of the audiobook is covered.
 *
 * - Same-section gaps: inherit the earlier entry's CFI (keep highlight).
 * - Cross-section gaps: empty CFI — triggers relocation via sectionIndex
 *   but does NOT inject a fake highlight from the wrong section.
 */
export function fillSyncMapGaps(entries: AudiobookSyncMapEntry[]): AudiobookSyncMapEntry[] {
  if (entries.length === 0) return entries;

  const sorted = [...entries].sort((a, b) => a.secondsStart - b.secondsStart);
  const filled: AudiobookSyncMapEntry[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    filled.push(cur);

    const next = sorted[i + 1];
    if (next && cur.secondsEnd !== undefined && cur.secondsEnd < next.secondsStart) {
      const crossSection =
        cur.sectionIndex !== undefined &&
        next.sectionIndex !== undefined &&
        cur.sectionIndex !== next.sectionIndex;

      filled.push({
        secondsStart: cur.secondsEnd,
        secondsEnd: next.secondsStart,
        // Cross-section: no CFI (relocation only). Same-section: keep highlight.
        cfi: crossSection ? '' : cur.cfi,
        markerCfi: crossSection ? undefined : cur.markerCfi,
        sectionIndex: next.sectionIndex,
        sectionHref: next.sectionHref,
        label: cur.label,
        source: 'gap-fill',
        matchScore: 0,
      });
    }
  }

  return filled;
}

/**
 * Finds the active sync map entry at the given playback time.
 *
 * An entry is active when `secondsStart <= currentTime` AND
 * (`secondsEnd` is undefined OR `currentTime < secondsEnd`).
 *
 * Returns null if no entry applies.
 */
export function findAudiobookSyncEntryAtTime(
  syncMap: AudiobookSyncMapEntry[] | undefined,
  currentTime: number,
  trackIndex?: number,
): AudiobookSyncMapEntry | null {
  if (!syncMap || syncMap.length === 0) return null;

  for (const entry of syncMap) {
    if (
      trackIndex !== undefined &&
      entry.trackIndex !== undefined &&
      entry.trackIndex !== trackIndex
    ) {
      continue;
    }

    if (currentTime < entry.secondsStart) continue;

    if (entry.secondsEnd !== undefined && currentTime >= entry.secondsEnd) continue;

    return entry;
  }

  return null;
}

/**
 * Returns a stable string key for a sync map entry, useful for deduping
 * marker updates so we don't re-apply the same marker on every timeupdate.
 */
export function getSyncMapEntryKey(entry: AudiobookSyncMapEntry): string {
  return `${entry.secondsStart}|${entry.cfi}|${entry.markerCfi ?? ''}`;
}

/**
 * @deprecated Use `findAudiobookSyncEntryAtTime` instead.
 * Legacy lookup that finds the entry with the largest `secondsStart <= currentTime`.
 * Kept for backward compatibility with old flat syncMap format.
 */
export function findAudiobookSyncEntry(
  syncMap: AudiobookSyncMapEntry[] | undefined,
  currentTime: number,
): AudiobookSyncMapEntry | null {
  if (!syncMap || syncMap.length === 0) return null;

  // Support old format entries that used `time` instead of `secondsStart`
  let bestEntry: AudiobookSyncMapEntry | null = null;

  for (const entry of syncMap) {
    const start = (entry as unknown as { time?: number }).time ?? entry.secondsStart;
    if (start <= currentTime) {
      if (!bestEntry) {
        bestEntry = entry;
      } else {
        const bestStart =
          (bestEntry as unknown as { time?: number }).time ?? bestEntry.secondsStart;
        if (start > bestStart) bestEntry = entry;
      }
    }
  }

  return bestEntry;
}
