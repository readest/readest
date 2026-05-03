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
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      // Normalize em-dash and en-dash to space (word boundary)
      .replace(/[–—―]/g, ' ')
      // Normalize horizontal ellipsis to space
      .replace(/…/g, ' ')
      // Remove zero-width and invisible characters
      .replace(/[​‌﻿­]/g, '')
      .replace(/‍/g, '')
      // Remove directional marks
      .replace(/[‎‏‪-‮]/g, '')
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

// Common English function words excluded from meaningful-token scoring.
// Keeping this list focused on words that provide no signal about topic.
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'as',
  'if',
  'then',
  'than',
  'when',
  'where',
  'how',
  'what',
  'who',
  'which',
  'not',
  'no',
  'so',
  'up',
  'out',
  'my',
  'your',
  'his',
  'her',
  'our',
  'their',
  'we',
  'they',
  'he',
  'she',
  'i',
  'you',
  'me',
  'him',
  'us',
  'them',
  'all',
  'any',
  'each',
  'every',
  'some',
  'about',
  'into',
  'over',
  'after',
  'before',
  'there',
  'here',
  'just',
  'also',
  'only',
  'very',
  'much',
  'more',
  'most',
  'other',
  'own',
  'same',
  'such',
  'now',
  'even',
  'back',
  'am',
  'well',
  'quite',
]);

/** Minimum normalized character length for containment to apply. */
const MIN_CONTAINMENT_CHARS = 10;

/**
 * Minimum number of meaningful (non-stop-word) token occurrences that the
 * transcript segment must contain before token-overlap scoring is attempted.
 * Prevents short stop-word-heavy phrases from scoring against any book passage.
 */
const MIN_MEANINGFUL_TOKENS = 4;

interface MatchResult {
  textUnit: AudiobookTextUnit;
  unitIndex: number;
  score: number;
  matchType: MatchPass;
}

/** Which scoring pass produced the best score. */
type MatchPass = 'containment' | 'reverse-containment' | 'token-overlap';

/** Default minimum score to accept a match (0–1 scale) */
const DEFAULT_MATCH_THRESHOLD = 0.55;

/** Score below which a match is considered "low confidence" */
const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** How much better a backward-jump score must be to override monotonic preference */
const MONOTONIC_BONUS = 0.05;

interface MatchTranscriptOptions {
  /** Minimum char length of transcript text to attempt matching; default 5 */
  minSegmentLength?: number;
  /** Minimum score (0–1) to accept a match; default 0.55 */
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
  /** Which scoring pass produced the winning score. */
  matchType?: MatchPass;
  /** First 60 chars of the matched text unit (for debugging). */
  unitTextPreview?: string;
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
 * Returns the meaningful (non-stop-word) tokens from a normalized string.
 * Token count is used to guard against stop-word-heavy false positives.
 */
function getMeaningfulTokens(norm: string): string[] {
  return norm.split(' ').filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/**
 * Computes a token-overlap score between two normalized strings using only
 * meaningful (non-stop-word) tokens.
 *
 * Requirements before scoring:
 * - The segment must have ≥ MIN_MEANINGFUL_TOKENS occurrences (may include
 *   duplicates) to ensure it carries enough topical signal.
 * - The unit must have at least one meaningful token.
 *
 * Score = (unique meaningful tokens shared) / (unique meaningful segment tokens).
 */
function tokenOverlapScore(normSeg: string, normUnit: string): number {
  const segTokens = getMeaningfulTokens(normSeg);
  const unitTokens = getMeaningfulTokens(normUnit);

  // Require minimum meaningful token count in the segment (total, counts dupes)
  if (segTokens.length < MIN_MEANINGFUL_TOKENS) return 0;
  if (unitTokens.length === 0) return 0;

  const segSet = new Set(segTokens);
  const unitSet = new Set(unitTokens);

  let overlap = 0;
  for (const token of segSet) {
    if (unitSet.has(token)) overlap++;
  }

  // Fraction of the segment's unique meaningful tokens found in the unit
  return overlap / segSet.size;
}

/**
 * Scores a normalized segment against a single normalized text unit.
 * Returns the best score and the pass that produced it.
 *
 * Pass 1 – containment: unit contains segment (requires ≥ MIN_CONTAINMENT_CHARS).
 * Pass 2 – reverse containment: segment contains unit (requires ≥ MIN_CONTAINMENT_CHARS).
 * Pass 3 – token overlap: meaningful-token overlap ratio.
 */
function scoreSegmentToUnit(
  normSeg: string,
  normUnit: string,
): { score: number; matchType: MatchPass } {
  if (normUnit.length === 0) return { score: 0, matchType: 'token-overlap' };

  // Pass 1: containment — segment must be long enough to be non-trivial
  if (normSeg.length >= MIN_CONTAINMENT_CHARS && normUnit.includes(normSeg)) {
    return { score: 1, matchType: 'containment' };
  }

  // Pass 2: reverse containment — unit must be long enough to be non-trivial
  if (normUnit.length >= MIN_CONTAINMENT_CHARS && normSeg.includes(normUnit)) {
    return { score: normUnit.length / normSeg.length, matchType: 'reverse-containment' };
  }

  // Pass 3: token overlap with stop-word filtering
  return { score: tokenOverlapScore(normSeg, normUnit), matchType: 'token-overlap' };
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
      const single = scoreSegmentToUnit(normSeg, norm);
      // Score against adjacent window
      const window = scoreSegmentToUnit(normSeg, windowNorms[unitIdx]!.combinedNorm);

      // Take the better of single vs window
      const rawScore = single.score >= window.score ? single.score : window.score;
      const rawMatchType: MatchPass =
        single.score >= window.score ? single.matchType : window.matchType;

      if (rawScore < matchThreshold) continue;

      // Apply monotonic preference: boost forward/same-index candidates
      let adjustedScore = rawScore;
      if (useMonotonic && lastMatchedUnitIndex >= 0) {
        if (unitIdx >= lastMatchedUnitIndex) {
          adjustedScore = rawScore + MONOTONIC_BONUS;
        }
      }

      if (!best || adjustedScore > best.score) {
        best = {
          textUnit: windowNorms[unitIdx]!.centerUnit,
          unitIndex: unitIdx,
          score: adjustedScore,
          matchType: rawMatchType,
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
      matchType: isMatched ? best!.matchType : undefined,
      unitTextPreview: isMatched ? best!.textUnit.text.slice(0, 60) : undefined,
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
