import { AudiobookSyncMapEntry, AudiobookTextUnit, AudiobookTranscriptSegment } from '@/types/book';

// ── Text normalization ──────────────────────────────────────────────

/**
 * Normalizes text for robust matching between transcript and EPUB text.
 * Handles curly quotes, dashes, invisible chars, punctuation, and whitespace.
 */
export function normalizeAudiobookMatchText(text: string): string {
  return (
    text
      // Normalize curly/smart quotes and apostrophes to ASCII
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // Normalize em-dash and en-dash to space (word boundary)
      .replace(/[\u2013\u2014\u2015]/g, ' ')
      // Normalize horizontal ellipsis to space
      .replace(/\u2026/g, ' ')
      // Remove zero-width and invisible characters
      .replace(/[\u200B\u200C\uFEFF\u00AD]/g, '')
      .replace(/\u200D/g, '')
      // Remove directional marks
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      // Lowercase
      .toLowerCase()
      // Remove remaining punctuation (unicode categories P and S)
      .replace(/[\p{P}\p{S}]/gu, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ── Transcript parsers ───────────────────────────────────────────────

/**
 * Parses SRT subtitle format into transcript segments.
 */
export function parseSRT(srtText: string): AudiobookTranscriptSegment[] {
  const segments: AudiobookTranscriptSegment[] = [];
  const blocks = srtText.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const timeLine = lines[1]!;
    const textLines = lines.slice(2).filter((l) => l.trim().length > 0);
    if (textLines.length === 0) continue;

    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!timeMatch) continue;

    const start =
      Number(timeMatch[1]) * 3600 +
      Number(timeMatch[2]) * 60 +
      Number(timeMatch[3]) +
      Number(timeMatch[4]) / 1000;

    const end =
      Number(timeMatch[5]) * 3600 +
      Number(timeMatch[6]) * 60 +
      Number(timeMatch[7]) +
      Number(timeMatch[8]) / 1000;

    segments.push({
      start,
      end,
      text: textLines.join(' ').trim(),
    });
  }

  return segments;
}

/**
 * Parses WebVTT format into transcript segments.
 */
export function parseVTT(vttText: string): AudiobookTranscriptSegment[] {
  const segments: AudiobookTranscriptSegment[] = [];
  const cleaned = vttText.replace(/^WEBVTT[^\n]*\n\n?/i, '');
  const blocks = cleaned.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx]!;
    const textLines = lines.slice(timeLineIdx + 1).filter((l) => l.trim().length > 0);
    if (textLines.length === 0) continue;

    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.](\d{3})/,
    );
    if (!timeMatch) continue;

    const start =
      Number(timeMatch[1]) * 3600 +
      Number(timeMatch[2]) * 60 +
      Number(timeMatch[3]) +
      Number(timeMatch[4]) / 1000;

    const end =
      Number(timeMatch[5]) * 3600 +
      Number(timeMatch[6]) * 60 +
      Number(timeMatch[7]) +
      Number(timeMatch[8]) / 1000;

    segments.push({
      start,
      end,
      text: textLines.join(' ').trim(),
    });
  }

  return segments;
}

/**
 * Parses a JSON transcript. Accepts either:
 * - An array of `{ start, end?, text }` objects
 * - An object with a `segments` array property
 */
export function parseTranscriptJSON(json: string): AudiobookTranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  let rawSegments: unknown[];
  if (Array.isArray(parsed)) {
    rawSegments = parsed;
  } else if (parsed && typeof parsed === 'object' && 'segments' in parsed) {
    rawSegments = Array.isArray((parsed as { segments: unknown }).segments)
      ? (parsed as { segments: unknown[] }).segments
      : [];
  } else {
    return [];
  }

  return rawSegments.filter(isValidRawSegment).map((s) => ({
    start: (s as { start: number }).start,
    end: (s as { end?: number }).end,
    text: (s as { text: string }).text.trim(),
  }));
}

function isValidRawSegment(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj['start'] === 'number' &&
    Number.isFinite(obj['start']) &&
    obj['start'] >= 0 &&
    typeof obj['text'] === 'string' &&
    (obj['text'] as string).trim().length > 0
  );
}

/**
 * Auto-detects transcript format and parses it.
 * Supports: JSON (array or {segments}), VTT, SRT.
 */
export function parseAudiobookTranscript(input: string): AudiobookTranscriptSegment[] {
  const trimmed = input.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseTranscriptJSON(trimmed);
  }

  if (/^WEBVTT/i.test(trimmed)) {
    return parseVTT(trimmed);
  }

  if (/^\d+\s*\n/.test(trimmed)) {
    return parseSRT(trimmed);
  }

  return parseSRT(trimmed);
}

// ── Segment normalization ────────────────────────────────────────────

/**
 * Filters invalid segments, sorts by start time, trims text,
 * and de-dupes exact duplicate (start + text) pairs.
 */
export function normalizeTranscriptSegments(
  segments: AudiobookTranscriptSegment[] | undefined,
): AudiobookTranscriptSegment[] {
  if (!segments || segments.length === 0) return [];

  const valid = segments.filter(
    (s) =>
      typeof s.start === 'number' &&
      Number.isFinite(s.start) &&
      s.start >= 0 &&
      typeof s.text === 'string' &&
      s.text.trim().length > 0,
  );

  valid.sort((a, b) => a.start - b.start);

  const seen = new Set<string>();
  return valid.filter((s) => {
    const key = `${s.start}|${s.text.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Matching: transcript segments → EPUB text units ──────────────────

interface MatchResult {
  textUnit: AudiobookTextUnit;
  score: number;
}

/**
 * Computes a token-overlap score between two normalized strings.
 * Returns a value between 0 and 1 representing the fraction of
 * shorter-text tokens found in the longer-text tokens.
 */
function tokenOverlapScore(normA: string, normB: string): number {
  const tokensA = normA.split(' ').filter(Boolean);
  const tokensB = normB.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  const longerSet = new Set(longer);
  let overlap = 0;
  for (const token of shorter) {
    if (longerSet.has(token)) overlap++;
  }

  return overlap / shorter.length;
}

/** Minimum score to accept a match (0–1 scale) */
const MATCH_THRESHOLD = 0.4;

interface MatchTranscriptOptions {
  /** Minimum char length of transcript text to attempt matching; default 5 */
  minSegmentLength?: number;
}

/**
 * Matches transcript segments to EPUB text units using normalized text comparison.
 *
 * Strategy (per segment):
 * 1. Pass 1 — containment: does a normalized text unit contain the normalized segment text?
 * 2. Pass 2 — reverse containment: does the normalized segment text contain the text unit text?
 * 3. Pass 3 — token overlap score above threshold
 *
 * The best match above threshold is chosen. Unmatched segments are skipped.
 *
 * Returns `AudiobookSyncMapEntry[]` with `source: 'transcript-match'`.
 */
export function matchTranscriptSegmentsToTextUnits(
  segments: AudiobookTranscriptSegment[] | undefined,
  textUnits: AudiobookTextUnit[] | undefined,
  options?: MatchTranscriptOptions,
): AudiobookSyncMapEntry[] {
  const normSegments = normalizeTranscriptSegments(segments);
  if (normSegments.length === 0 || !textUnits || textUnits.length === 0) return [];

  const minLen = options?.minSegmentLength ?? 5;

  // Pre-normalize text units
  const normUnits = textUnits.map((u) => ({
    unit: u,
    norm: normalizeAudiobookMatchText(u.text),
  }));

  const entries: AudiobookSyncMapEntry[] = [];

  for (const seg of normSegments) {
    if (seg.text.trim().length < minLen) continue;

    const normSeg = normalizeAudiobookMatchText(seg.text);

    // Pass 1: text unit contains segment text
    let best: MatchResult | null = null;

    for (const { unit, norm } of normUnits) {
      if (norm.length === 0) continue;

      // Pass 1: containment
      if (norm.includes(normSeg)) {
        const score = normSeg.length > 0 ? 1 : 0;
        if (!best || score > best.score) {
          best = { textUnit: unit, score };
        }
        continue; // containment is a strong signal; no need for further passes on this unit
      }

      // Pass 2: reverse containment
      if (normSeg.includes(norm)) {
        const score = norm.length / normSeg.length;
        if (!best || score > best.score) {
          best = { textUnit: unit, score };
        }
        continue;
      }

      // Pass 3: token overlap
      const score = tokenOverlapScore(normSeg, norm);
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
        best = { textUnit: unit, score };
      }
    }

    if (best && best.score >= MATCH_THRESHOLD) {
      entries.push({
        secondsStart: seg.start,
        secondsEnd: seg.end,
        cfi: best.textUnit.cfi,
        label: seg.text.trim().slice(0, 60),
        source: 'transcript-match',
      });
    }
  }

  return entries;
}
