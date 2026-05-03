import { AudiobookSyncMapEntry, AudiobookTranscriptSegment, BookSearchMatch } from '@/types/book';
import { normalizeAudiobookMatchText } from '@/utils/audiobookTranscript';

// Re-export from the primary audiobookTranscript utility for backward compat
export {
  normalizeAudiobookMatchText as normalizeForSpotMatch,
  parseSRT,
  parseVTT,
  parseTranscriptJSON,
  parseAudiobookTranscript as parseTranscript,
  normalizeTranscriptSegments,
} from '@/utils/audiobookTranscript';

// ── Sync map generation from transcript (placeholder CFI) ────────────

interface BuildSyncMapFromTranscriptOptions {
  duration?: number;
  minSegmentLength?: number;
}

/**
 * Converts transcript segments into a sorted sync map with placeholder CFIs.
 * Use `matchTranscriptSegmentsToTextUnits` from audiobookTranscript.ts
 * for the preferred pure-matching pipeline instead.
 */
export function buildSyncMapFromTranscript(
  segments: AudiobookTranscriptSegment[] | undefined,
  options?: BuildSyncMapFromTranscriptOptions,
): AudiobookSyncMapEntry[] {
  // Inline normalization to avoid circular re-export
  const valid = (segments ?? []).filter(
    (s) =>
      typeof s.start === 'number' &&
      Number.isFinite(s.start) &&
      s.start >= 0 &&
      typeof s.text === 'string' &&
      s.text.trim().length > 0,
  );
  valid.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const normalized = valid.filter((s) => {
    const key = `${s.start}|${s.text.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (normalized.length === 0) return [];

  const duration = options?.duration;
  const minLen = options?.minSegmentLength ?? 5;

  const filtered = normalized.filter((s) => s.text.trim().length >= minLen);
  if (filtered.length === 0) return [];

  const entries: AudiobookSyncMapEntry[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const seg = filtered[i]!;
    const nextSeg = filtered[i + 1];

    const entry: AudiobookSyncMapEntry = {
      secondsStart: seg.start,
      secondsEnd: nextSeg ? nextSeg.start : seg.end,
      cfi: '',
      label: seg.text.trim().slice(0, 60),
      source: 'generated',
    };

    if (
      !nextSeg &&
      !entry.secondsEnd &&
      duration !== undefined &&
      Number.isFinite(duration) &&
      duration > seg.start
    ) {
      entry.secondsEnd = duration;
    }

    entries.push(entry);
  }

  return entries;
}

// ── EPUB search-based matching (legacy) ──────────────────────────────

/**
 * From a list of search matches for a transcript segment's text, selects
 * the best one by word overlap score.
 */
export function selectBestSpotMatch(
  transcriptText: string,
  searchMatches: BookSearchMatch[],
): BookSearchMatch | null {
  if (searchMatches.length === 0) return null;

  const normalizedTranscript = normalizeAudiobookMatchText(transcriptText);

  let bestMatch: BookSearchMatch | null = null;
  let bestScore = -1;

  for (const match of searchMatches) {
    const excerptText =
      typeof match.excerpt === 'string'
        ? match.excerpt
        : ((match.excerpt as { pre?: string; match?: string; post?: string })?.match ?? '');
    const normalizedExcerpt = normalizeAudiobookMatchText(excerptText);

    const transcriptWords = new Set(normalizedTranscript.split(' ').filter(Boolean));
    const excerptWords = normalizedExcerpt.split(' ').filter(Boolean);
    let overlap = 0;
    for (const word of excerptWords) {
      if (transcriptWords.has(word)) overlap++;
    }

    const score = transcriptWords.size > 0 ? overlap / transcriptWords.size : 0;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }

  return bestScore >= 0.3 ? bestMatch : null;
}

/**
 * Resolves CFIs for generated sync map entries by searching the EPUB text.
 * Async operation that uses the FoliateView search API.
 */
export async function resolveTranscriptSyncMapCFIs(
  syncMap: AudiobookSyncMapEntry[],
  searchFn: (query: string) => Promise<BookSearchMatch[]>,
): Promise<AudiobookSyncMapEntry[]> {
  const resolved: AudiobookSyncMapEntry[] = [];

  for (const entry of syncMap) {
    if (entry.cfi && entry.cfi.length > 0) {
      resolved.push(entry);
      continue;
    }

    const searchText = entry.label;
    if (!searchText || searchText.length < 5) continue;

    try {
      const matches = await searchFn(searchText);
      const bestMatch = selectBestSpotMatch(searchText, matches);

      if (bestMatch && bestMatch.cfi) {
        resolved.push({
          ...entry,
          cfi: bestMatch.cfi,
        });
      }
    } catch (err) {
      console.warn('[TranscriptSync] Search failed for segment', {
        secondsStart: entry.secondsStart,
        label: entry.label,
        error: err,
      });
    }
  }

  return resolved;
}
