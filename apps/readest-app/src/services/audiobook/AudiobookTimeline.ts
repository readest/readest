import type { ABSChapter, ABSTrack } from '@/types/audiobookshelf';

export class AudiobookTimeline {
  private sortedTracks: ABSTrack[];
  private sortedChapters: ABSChapter[];
  readonly duration: number;

  constructor(tracks: ABSTrack[], chapters: ABSChapter[]) {
    // Sort tracks by startOffset (ABS's startOffset is authoritative)
    this.sortedTracks = [...tracks].sort((a, b) => a.startOffset - b.startOffset);

    // Sort chapters by start time
    this.sortedChapters = [...chapters].sort((a, b) => a.start - b.start);

    // Duration is the sum of all track durations
    this.duration = this.sortedTracks.reduce((sum, track) => sum + track.duration, 0);
  }

  /**
   * Locate which track contains a global position and the offset within that track.
   * Returns trackIndex as the 0-based array index into sortedTracks.
   * Clamps out-of-range positions to [0, duration].
   */
  locate(globalSec: number): { trackIndex: number; offset: number } {
    // Clamp to valid range
    const clamped = Math.max(0, Math.min(globalSec, this.duration));

    // Binary search for the track containing this position
    let left = 0;
    let right = this.sortedTracks.length - 1;
    let result = 0; // Default to first track

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midTrack = this.sortedTracks[mid];

      if (midTrack && midTrack.startOffset <= clamped) {
        result = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    const track = this.sortedTracks[result];
    if (!track) {
      // Fallback should not happen with valid input, but satisfy TS
      return { trackIndex: 0, offset: 0 };
    }
    let offset = clamped - track.startOffset;
    // Clamp offset to track's own duration to handle VBR drift in ABS startOffsets
    offset = Math.max(0, Math.min(offset, track.duration));

    return { trackIndex: result, offset };
  }

  /**
   * Convert track index + in-track offset to global seconds.
   * Invariant: trackIndex must come from locate(); out-of-range indices return 0 by design.
   */
  toGlobal(trackIndex: number, offset: number): number {
    const track = this.sortedTracks[trackIndex];
    if (!track) {
      // Out-of-range indices (not from locate) silently return 0
      return 0;
    }
    return track.startOffset + offset;
  }

  /**
   * Find the chapter containing a global position.
   * Returns the last chapter whose start <= globalSec, or null if no chapters.
   */
  chapterAt(globalSec: number): ABSChapter | null {
    if (this.sortedChapters.length === 0) {
      return null;
    }

    // Binary search for the last chapter whose start <= globalSec
    let result: ABSChapter | null = null;

    for (const chapter of this.sortedChapters) {
      if (chapter.start <= globalSec) {
        result = chapter;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Get the start of the next chapter for transport jumps.
   * Returns null if at or after the last chapter's start.
   */
  nextChapterStart(globalSec: number): number | null {
    if (this.sortedChapters.length === 0) {
      return null;
    }

    for (const chapter of this.sortedChapters) {
      if (chapter.start > globalSec) {
        return chapter.start;
      }
    }

    return null;
  }

  /**
   * Get the start of the previous chapter for transport jumps.
   * If > 3s into the current chapter, restart the current chapter (return its start).
   * Otherwise, jump to the previous chapter start, clamped to 0.
   */
  prevChapterStart(globalSec: number): number {
    if (this.sortedChapters.length === 0) {
      return 0;
    }

    // Find the current chapter
    const currentChapter = this.chapterAt(globalSec);

    if (!currentChapter) {
      // Before any chapter
      return 0;
    }

    const offsetIntoChapter = globalSec - currentChapter.start;

    // If > 3s into the current chapter, restart it
    if (offsetIntoChapter > 3) {
      return currentChapter.start;
    }

    // Otherwise, jump to the previous chapter start
    // Find the chapter before currentChapter
    const currentIndex = this.sortedChapters.indexOf(currentChapter);

    if (currentIndex <= 0) {
      // No previous chapter, clamp to 0
      return 0;
    }

    const prevChapter = this.sortedChapters[currentIndex - 1];
    if (!prevChapter) {
      return 0;
    }
    return prevChapter.start;
  }
}
