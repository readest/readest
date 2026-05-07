import {
  AudiobookSyncMapEntry,
  AudiobookTextUnit,
  AudiobookTranscriptSegment,
  BookSearchMatch,
} from '@/types/book';
import { SectionItem } from '@/libs/document';
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

// ── Whole-book EPUB text unit extraction ─────────────────────────────

/** Minimal view interface needed for whole-book extraction */
export interface BookViewLike {
  book: { sections: SectionItem[] };
  getCFI(index: number, range: Range): string;
}

const BLOCK_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt';
const MIN_TEXT_LENGTH = 3;

/**
 * Extracts AudiobookTextUnit[] from the entire EPUB by iterating every
 * section in the spine, loading its document via `section.createDocument()`,
 * and resolving CFIs for each readable block element.
 *
 * This is the preferred extraction path for transcript matching because it
 * covers the whole book, not just the currently visible sections.
 *
 * Sections with `linear === 'no'` are skipped (non-linear auxiliary content).
 * Sections without `createDocument` are skipped.
 *
 * Performance: this is async and may be expensive for large books.
 * Only call it on-demand (e.g. when the dev API is invoked), not on mount.
 */
export async function extractTextUnitsFromWholeBook(view: BookViewLike): Promise<{
  units: AudiobookTextUnit[];
  sectionsScanned: number;
  sectionsSkipped: number;
}> {
  const units: AudiobookTextUnit[] = [];
  const sections = view.book?.sections ?? [];
  let sectionsScanned = 0;
  let sectionsSkipped = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;

    // Skip non-linear sections (covers, auxiliary content)
    if (section.linear === 'no') {
      sectionsSkipped++;
      continue;
    }

    // Skip sections that can't create documents
    if (typeof section.createDocument !== 'function') {
      sectionsSkipped++;
      continue;
    }

    let doc: Document;
    try {
      doc = await section.createDocument();
    } catch {
      sectionsSkipped++;
      continue;
    }

    if (!doc) {
      sectionsSkipped++;
      continue;
    }

    sectionsScanned++;

    const blocks = doc.querySelectorAll(BLOCK_SELECTORS);
    for (const block of blocks) {
      const el = block as HTMLElement;
      const text = el.textContent?.trim() ?? '';
      if (text.length < MIN_TEXT_LENGTH) continue;

      // Skip image/media-only blocks (no text nodes, only media children)
      if (isMediaOnlyBlock(el)) continue;

      try {
        const range = doc.createRange();
        range.selectNodeContents(el);
        const cfi = view.getCFI(i, range);
        if (cfi) {
          units.push({ cfi, text, sectionIndex: i, sectionHref: section.href });
        }
      } catch {
        // Skip blocks where CFI resolution fails
      }
    }
  }

  return { units, sectionsScanned, sectionsSkipped };
}

/**
 * Returns true if the element contains only media (img, audio, video, svg, canvas)
 * and no meaningful text content. Checks both element children and direct text nodes.
 */
function isMediaOnlyBlock(el: HTMLElement): boolean {
  const mediaTags = new Set(['img', 'image', 'audio', 'video', 'svg', 'canvas']);

  // Check for direct text node children with non-whitespace content
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0) {
      return false; // Has real text → not media-only
    }
  }

  const children = el.children;
  if (children.length === 0) return false; // text-only is fine

  let hasMedia = false;
  let hasNonMedia = false;
  for (let i = 0; i < children.length; i++) {
    const tag = children[i]!.tagName.toLowerCase();
    if (mediaTags.has(tag)) {
      hasMedia = true;
    } else {
      hasNonMedia = true;
    }
  }

  // If there are only media children and no non-media children, it's media-only
  return hasMedia && !hasNonMedia;
}

// ── Visible-section extraction (fallback) ────────────────────────────

/** Minimal view interface for visible-section extraction */
export interface VisibleViewLike {
  book?: { sections: { href?: string }[] };
  renderer: { getContents(): { doc: Document; index?: number }[] };
  getCFI(index: number, range: Range): string;
}

/**
 * Extracts AudiobookTextUnit[] from currently loaded/visible EPUB sections.
 * Only covers what the renderer has loaded — not the whole book.
 * Use as a fallback when whole-book extraction fails or returns zero units.
 */
export function extractTextUnitsFromVisibleSections(view: VisibleViewLike): AudiobookTextUnit[] {
  const units: AudiobookTextUnit[] = [];
  const sections = view.book?.sections ?? [];

  const contents = view.renderer?.getContents?.() ?? [];
  for (const content of contents) {
    const doc = content.doc as Document | undefined;
    const index = content.index ?? 0;
    if (!doc) continue;

    const sectionHref = sections[index]?.href;

    const blocks = doc.querySelectorAll(BLOCK_SELECTORS);
    for (const block of blocks) {
      const el = block as HTMLElement;
      const text = el.textContent?.trim() ?? '';
      if (text.length < MIN_TEXT_LENGTH) continue;

      try {
        const range = doc.createRange();
        range.selectNodeContents(el);
        const cfi = view.getCFI(index, range);
        if (cfi) {
          units.push({ cfi, text, sectionIndex: index, sectionHref });
        }
      } catch {
        // Skip blocks where CFI resolution fails
      }
    }
  }

  return units;
}

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
