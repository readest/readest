import { AudiobookSyncMapEntry } from '@/types/book';

/**
 * Finds the latest sync map entry that should be active at the given time.
 * Returns the entry with the largest time value that is <= currentTime.
 * Returns null if no entry applies (all entries are in the future or map is empty).
 */
export function findAudiobookSyncEntry(
  syncMap: AudiobookSyncMapEntry[] | undefined,
  currentTime: number,
): AudiobookSyncMapEntry | null {
  if (!syncMap || syncMap.length === 0) {
    return null;
  }

  let bestEntry: AudiobookSyncMapEntry | null = null;

  for (const entry of syncMap) {
    if (entry.time <= currentTime) {
      if (!bestEntry || entry.time > bestEntry.time) {
        bestEntry = entry;
      }
    }
  }

  return bestEntry;
}
