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
  unitIndex: number;
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

/** Default minimum score to accept a match (0–1 scale) */
const DEFAULT_MATCH_THRESHOLD = 0.4;

/** Score below which a match is considered "low confidence" */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** How much better a backward-jump score must be to override monotonic preference */
const MONOTONIC_BONUS = 0.05;

interface MatchTranscriptOptions {
  /** Minimum char length of transcript text to attempt matching; default 5 */
  minSegmentLength?: number;
  /** Minimum score (0–1) to accept a match; default 0.4 */
  matchThreshold?: number;
  /** Size of sliding window of adjacent text units to combine; default 2 */
  adjacentWindowSize?: number;
  /** Whether to apply monotonic forward-progression preference; default true */
  monotonicPreference?: boolean;
}

/** Diagnostics for a single match attempt */
export interface SegmentDiagnostic {
  segmentIndex: number;
  secondsStart: number;
  text: string;
  matched: boolean;
  score: number;
  cfi: string;
  unitIndex: number;
  sectionIndex?: number;
  lowConfidence: boolean;
}

/** Aggregate diagnostics for a full matching run */
export interface MatchDiagnostics {
  totalSegments: number;
  matchedCount: number;
  skippedCount: number;
  lowConfidenceCount: number;
  averageScore: number;
  sectionDistribution: Record<number, number>;
  topSkipped: SegmentDiagnostic[];
  topLowConfidence: SegmentDiagnostic[];
}

/**
 * Scores a normalized segment against a single normalized text unit.
 * Returns the best score from containment, reverse containment, or token overlap.
 */
function scoreSegmentToUnit(normSeg: string, normUnit: string): number {
  if (normUnit.length === 0) return 0;

  // Pass 1: containment (unit contains segment)
  if (normUnit.includes(normSeg)) {
    return 1;
  }

  // Pass 2: reverse containment (segment contains unit)
  if (normSeg.includes(normUnit)) {
    return normUnit.length / normSeg.length;
  }

  // Pass 3: token overlap
  return tokenOverlapScore(normSeg, normUnit);
}

/**
 * Builds a combined normalized text from a window of adjacent text units.
 * Joins with a space so sentences spanning paragraphs can match.
 */
function buildWindowNorm(
  normUnits: { unit: AudiobookTextUnit; norm: string }[],
  centerIndex: number,
  windowSize: number,
): { combinedNorm: string; centerUnit: AudiobookTextUnit } {
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, centerIndex - half);
  const end = Math.min(normUnits.length - 1, centerIndex + half);

  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    const n = normUnits[i]!.norm;
    if (n.length > 0) parts.push(n);
  }

  return {
    combinedNorm: parts.join(' '),
    centerUnit: normUnits[centerIndex]!.unit,
  };
}

/**
 * Matches transcript segments to EPUB text units using normalized text comparison.
 *
 * Strategy (per segment):
 * 1. For each text unit, score against single unit AND against a sliding window
 *    of adjacent units (to handle sentences spanning paragraphs).
 * 2. Apply monotonic forward-progression preference: later transcript segments
 *    prefer same/later text unit indices unless a backward jump has a
 *    significantly better score.
 * 3. The best match above threshold is chosen. Unmatched segments are skipped.
 *
 * Returns `AudiobookSyncMapEntry[]` with `source: 'transcript-match'`,
 * `matchScore`, and `sectionIndex`.
 */
export function matchTranscriptSegmentsToTextUnits(
  segments: AudiobookTranscriptSegment[] | undefined,
  textUnits: AudiobookTextUnit[] | undefined,
  options?: MatchTranscriptOptions,
): AudiobookSyncMapEntry[] {
  const result = matchTranscriptSegmentsToTextUnitsWithDiagnostics(segments, textUnits, options);
  return result.entries;
}

/**
 * Full matching with diagnostics. Returns both sync map entries and
 * detailed diagnostics for inspection.
 */
export function matchTranscriptSegmentsToTextUnitsWithDiagnostics(
  segments: AudiobookTranscriptSegment[] | undefined,
  textUnits: AudiobookTextUnit[] | undefined,
  options?: MatchTranscriptOptions,
): { entries: AudiobookSyncMapEntry[]; diagnostics: MatchDiagnostics } {
  const normSegments = normalizeTranscriptSegments(segments);
  const emptyDiag: MatchDiagnostics = {
    totalSegments: 0,
    matchedCount: 0,
    skippedCount: 0,
    lowConfidenceCount: 0,
    averageScore: 0,
    sectionDistribution: {},
    topSkipped: [],
    topLowConfidence: [],
  };

  if (normSegments.length === 0 || !textUnits || textUnits.length === 0) {
    return { entries: [], diagnostics: emptyDiag };
  }

  const minLen = options?.minSegmentLength ?? 5;
  const matchThreshold = options?.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;
  const windowSize = options?.adjacentWindowSize ?? 2;
  const useMonotonic = options?.monotonicPreference ?? true;

  // Pre-normalize text units
  const normUnits = textUnits.map((u) => ({
    unit: u,
    norm: normalizeAudiobookMatchText(u.text),
  }));

  // Pre-build window norms for each unit index
  const windowNorms = normUnits.map((_, i) => buildWindowNorm(normUnits, i, windowSize));

  const entries: AudiobookSyncMapEntry[] = [];
  const segDiags: SegmentDiagnostic[] = [];
  let lastMatchedUnitIndex = -1;

  for (let segIdx = 0; segIdx < normSegments.length; segIdx++) {
    const seg = normSegments[segIdx]!;
    if (seg.text.trim().length < minLen) continue;

    const normSeg = normalizeAudiobookMatchText(seg.text);
    if (normSeg.length === 0) continue;

    let best: MatchResult | null = null;

    for (let unitIdx = 0; unitIdx < normUnits.length; unitIdx++) {
      const { norm } = normUnits[unitIdx]!;

      // Score against single unit
      const singleScore = scoreSegmentToUnit(normSeg, norm);

      // Score against adjacent window
      const windowScore = scoreSegmentToUnit(normSeg, windowNorms[unitIdx]!.combinedNorm);

      // Take the better of single vs window
      const rawScore = Math.max(singleScore, windowScore);

      if (rawScore < matchThreshold) continue;

      // Apply monotonic preference: boost forward/same-index candidates
      let adjustedScore = rawScore;
      if (useMonotonic && lastMatchedUnitIndex >= 0) {
        if (unitIdx >= lastMatchedUnitIndex) {
          // Forward or same: small bonus
          adjustedScore = rawScore + MONOTONIC_BONUS;
        }
        // Backward: no bonus, must be significantly better to win
      }

      if (!best || adjustedScore > best.score) {
        // Use the center unit of the window (same CFI whether single or window matched)
        best = {
          textUnit: windowNorms[unitIdx]!.centerUnit,
          unitIndex: unitIdx,
          score: adjustedScore,
        };
      }
    }

    const isMatched = best !== null && best.score >= matchThreshold;
    const finalScore = isMatched ? best!.score : 0;
    const isLowConfidence = isMatched && finalScore < LOW_CONFIDENCE_THRESHOLD;

    const diag: SegmentDiagnostic = {
      segmentIndex: segIdx,
      secondsStart: seg.start,
      text: seg.text.trim().slice(0, 80),
      matched: isMatched,
      score: Math.round(finalScore * 1000) / 1000,
      cfi: isMatched ? best!.textUnit.cfi : '',
      unitIndex: isMatched ? best!.unitIndex : -1,
      sectionIndex: isMatched ? best!.textUnit.sectionIndex : undefined,
      lowConfidence: isLowConfidence,
    };
    segDiags.push(diag);

    if (isMatched) {
      entries.push({
        secondsStart: seg.start,
        secondsEnd: seg.end,
        cfi: best!.textUnit.cfi,
        label: seg.text.trim().slice(0, 60),
        source: 'transcript-match',
        matchScore: Math.round(best!.score * 1000) / 1000,
        sectionIndex: best!.textUnit.sectionIndex,
      });
      lastMatchedUnitIndex = best!.unitIndex;
    }
  }

  // Build aggregate diagnostics
  const matched = segDiags.filter((d) => d.matched);
  const skipped = segDiags.filter((d) => !d.matched);
  const lowConf = segDiags.filter((d) => d.lowConfidence);

  const avgScore =
    matched.length > 0 ? matched.reduce((sum, d) => sum + d.score, 0) / matched.length : 0;

  const sectionDist: Record<number, number> = {};
  for (const d of matched) {
    const sec = d.sectionIndex ?? -1;
    sectionDist[sec] = (sectionDist[sec] ?? 0) + 1;
  }

  // Top 10 skipped (by segment index order)
  const topSkipped = skipped.slice(0, 10);

  // Top 10 low-confidence (sorted by score ascending)
  const topLowConf = [...lowConf].sort((a, b) => a.score - b.score).slice(0, 10);

  const diagnostics: MatchDiagnostics = {
    totalSegments: segDiags.length,
    matchedCount: matched.length,
    skippedCount: skipped.length,
    lowConfidenceCount: lowConf.length,
    averageScore: Math.round(avgScore * 1000) / 1000,
    sectionDistribution: sectionDist,
    topSkipped,
    topLowConfidence: topLowConf,
  };

  return { entries, diagnostics };
}
