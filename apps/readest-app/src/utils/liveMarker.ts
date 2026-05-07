import { Overlayer } from 'foliate-js/overlayer.js';
import { FoliateView } from '@/types/view';
import { normalizeAudiobookMatchText } from '@/utils/audiobookTranscript';

/** Overlay slot for the subtle phrase/sentence context highlight. */
export const LIVE_MARKER_KEY = 'tts-highlight';
/** Overlay slot for the active-word highlight that tracks the narrator. */
export const LIVE_MARKER_WORD_KEY = 'tts-word';

type LiveMarkerStyle = 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'outline';

interface LiveMarkerOptions {
  style: LiveMarkerStyle;
  color: string;
}

interface ScrollSettings {
  showHeader: boolean;
  showFooter: boolean;
  showBarsOnScroll: boolean;
  scrollingOverlap: number;
}

export type MarkerResult =
  | { status: 'applied' }
  | { status: 'wrong-section'; cfiSectionIndex: number }
  | { status: 'error'; reason: string };

/**
 * Scoring result for a text-node candidate during phrase matching.
 */
interface TextNodeScore {
  node: Text;
  overlap: number;
  ratio: number;
}

interface BlockCandidate {
  node: Text;
  overlap: number;
  rawRatio: number;
  adjustedRatio: number;
  location: string; // 'current' | 'next-1' | 'next-2' | 'prev-1' | 'prev-2'
  blockElement: Element;
}

const BLOCK_TAG_RE = /^(p|div|h[1-6]|li|blockquote|dd|dt|pre|td|th)$/;

function isBlockElement(el: Element): boolean {
  return BLOCK_TAG_RE.test(el.tagName.toLowerCase());
}

/**
 * Walks sibling elements from `startBlock` and collects up to `maxDistance`
 * adjacent block-level elements in each direction.
 */
function getAdjacentBlocks(
  startBlock: Element,
  maxDistance: number,
): { element: Element; direction: 'next' | 'prev'; distance: number }[] {
  const results: { element: Element; direction: 'next' | 'prev'; distance: number }[] = [];

  // Walk forward
  let next = startBlock.nextElementSibling;
  let dist = 1;
  while (next && dist <= maxDistance) {
    if (isBlockElement(next)) {
      results.push({ element: next, direction: 'next', distance: dist });
      dist++;
    }
    next = next.nextElementSibling;
  }

  // Walk backward
  let prev = startBlock.previousElementSibling;
  dist = 1;
  while (prev && dist <= maxDistance) {
    if (isBlockElement(prev)) {
      results.push({ element: prev, direction: 'prev', distance: dist });
      dist++;
    }
    prev = prev.previousElementSibling;
  }

  return results;
}

/**
 * Walks text nodes in `root` and returns the best match for `labelWords`.
 * If `anchorText` is provided, that node gets a +0.08 ratio bonus to break
 * ties toward the node closest to the CFI point.
 */
function findBestInSubtree(
  root: Node,
  labelWords: Set<string>,
  anchorText: Text | null,
  minRatio: number,
): TextNodeScore | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let best: TextNodeScore | null = null;

  let node: Text | null = walker.firstChild() as Text | null;
  while (node) {
    const content = node.textContent ?? '';
    if (content.trim().length >= 5) {
      const normContent = normalizeAudiobookMatchText(content);
      const contentWords = new Set(normContent.split(' ').filter(Boolean));
      let overlap = 0;
      for (const w of labelWords) {
        if (contentWords.has(w)) overlap++;
      }
      let ratio = overlap / labelWords.size;

      // Small proximity bonus for the exact anchor text node
      if (anchorText && node === anchorText) ratio += 0.08;

      if (ratio >= minRatio && (!best || ratio > best.ratio)) {
        best = { node, overlap, ratio };
      }
    }
    node = walker.nextNode() as Text | null;
  }

  return best;
}

/**
 * Returns the nearest block-level ancestor element, or null.
 */
function findBlockElement(startNode: Node): Element | null {
  let el: Node | null =
    startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement;
  while (el) {
    if (el.nodeType === Node.ELEMENT_NODE && isBlockElement(el as Element)) {
      return el as Element;
    }
    el = el.parentElement;
  }
  return null;
}

/** Creates a Range covering the entire content of `textNode`. */
function createTextNodeRange(doc: Document, textNode: Text): Range {
  const r = doc.createRange();
  const len = (textNode.textContent ?? '').length;
  r.setStart(textNode, 0);
  r.setEnd(textNode, len);
  return r;
}

// ── Substring-precise range construction ────────────────────────────────

/**
 * Mirrors `normalizeAudiobookMatchText` step-by-step while tracking which
 * original UTF-16 code-unit offset each surviving character came from.
 *
 * Returns `map[normalizedIndex] = originalOffset`, or `[]` if the input
 * has no surviving characters after normalization.
 */
function buildNormalizedOffsetMap(original: string): number[] {
  if (original.length === 0) return [];

  interface Slot {
    ch: string;
    orig: number;
  }

  // Phase 1: build list of {ch, orig} from the original string, handling
  // surrogate pairs by measuring each code point's UTF-16 length.
  const slots: Slot[] = [];
  let origOffset = 0;
  for (const ch of original) {
    slots.push({ ch, orig: origOffset });
    origOffset += ch.length; // 1 for BMP, 2 for supplementary
  }

  // Phase 2: apply transformations matching normalizeAudiobookMatchText

  // 2a. Curly single quotes → ASCII '
  for (const s of slots) {
    if ('‘’‚‛'.includes(s.ch)) s.ch = "'";
  }
  // 2b. Curly double quotes → ASCII "
  for (const s of slots) {
    if ('“”„‟'.includes(s.ch)) s.ch = '"';
  }
  // 2c. Em-dash, en-dash, horizontal bar → space
  for (const s of slots) {
    if ('–—―'.includes(s.ch)) s.ch = ' ';
  }
  // 2d. Horizontal ellipsis → space
  for (const s of slots) {
    if (s.ch === '…') s.ch = ' ';
  }
  // 2e. Remove zero-width / invisible characters
  const zwSet = new Set(['​', '‌', '‍', '﻿', '­']);
  for (let i = slots.length - 1; i >= 0; i--) {
    if (zwSet.has(slots[i]!.ch)) slots.splice(i, 1);
  }
  // 2f. Remove directional marks (U+200E–U+202E)
  for (let i = slots.length - 1; i >= 0; i--) {
    const cp = slots[i]!.ch.codePointAt(0)!;
    if (cp >= 0x200e && cp <= 0x202e) slots.splice(i, 1);
  }
  // 2g. Lowercase
  for (const s of slots) {
    s.ch = s.ch.toLowerCase();
  }
  // 2h. Remove Unicode punctuation and symbols
  const punctSym = /\p{P}|\p{S}/u;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (punctSym.test(slots[i]!.ch)) slots.splice(i, 1);
  }
  // 2i. Collapse whitespace runs — keep first space, remove consecutive
  for (let i = slots.length - 1; i >= 1; i--) {
    const cur = slots[i]!.ch;
    const prev = slots[i - 1]!.ch;
    if (cur === ' ' && prev === ' ') slots.splice(i, 1);
  }
  // 2j. Trim leading/trailing spaces
  while (slots.length > 0 && slots[0]!.ch === ' ') slots.shift();
  while (slots.length > 0 && slots[slots.length - 1]!.ch === ' ') slots.pop();

  return slots.map((s) => s.orig);
}

interface WindowResult {
  start: number; // normalized character index (inclusive)
  end: number; // normalized character index (exclusive)
  matchType: 'exact' | 'fuzzy';
}

/** Common short words excluded from meaningful-word counts. */
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
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'he',
  'she',
  'it',
  'we',
  'they',
  'his',
  'her',
  'its',
  'their',
  'that',
  'this',
  'with',
  'as',
  'from',
  'by',
  'not',
  'no',
  'so',
  'if',
  'then',
  'than',
  'all',
]);

/**
 * Finds the best region of `normalizedText` that corresponds to
 * `normalizedLabel`.  Tries an exact substring match first, then a
 * sliding word-window with overlap scoring.
 */
function findSubstringWindow(
  normalizedText: string,
  normalizedLabel: string,
  labelWords: Set<string>,
  maxLen: number,
): WindowResult | null {
  // ── Tier A: exact substring ──
  const idx = normalizedText.indexOf(normalizedLabel);
  if (idx !== -1) {
    let end = idx + normalizedLabel.length;
    if (end - idx > maxLen) end = idx + maxLen;
    return { start: idx, end, matchType: 'exact' };
  }

  // ── Tier B: sliding word window ──
  if (labelWords.size < 5) return null;

  const textWords = normalizedText.split(' ').filter(Boolean);
  const windowSize = labelWords.size;

  if (textWords.length < windowSize) return null;

  let bestOverlap = 0;
  let bestIdx = 0;

  for (let i = 0; i <= textWords.length - windowSize; i++) {
    let overlap = 0;
    for (let j = i; j < i + windowSize; j++) {
      if (labelWords.has(textWords[j]!)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }

  if (bestOverlap / labelWords.size < 0.3) return null;

  // Convert word window to character offsets
  let charStart = 0;
  for (let j = 0; j < bestIdx; j++) {
    charStart += textWords[j]!.length + 1; // +1 for the space separator
  }

  let charEnd = charStart;
  for (let j = bestIdx; j < bestIdx + windowSize; j++) {
    if (j > bestIdx) charEnd += 1; // space between words
    charEnd += textWords[j]!.length;
  }

  // Cap to maxLen at word boundary
  if (charEnd - charStart > maxLen) {
    const truncPos = normalizedText.lastIndexOf(' ', charStart + maxLen);
    charEnd = truncPos > charStart ? truncPos : charStart + maxLen;
  }

  return { start: charStart, end: charEnd, matchType: 'fuzzy' };
}

interface SubstringResult {
  range: Range;
  matchType: 'exact' | 'fuzzy';
}

/**
 * Creates a DOM Range covering only the substring within `textNode` that
 * best matches the transcript `label`.  Returns null if no reliable match
 * can be found, so callers can fall back to a full-text-node range.
 */
function createSubstringRange(
  doc: Document,
  textNode: Text,
  label: string,
  maxChars: number,
): SubstringResult | null {
  const originalText = textNode.textContent ?? '';
  if (originalText.trim().length < 5) return null;

  // Build offset map from normalized → original positions
  const offsetMap = buildNormalizedOffsetMap(originalText);
  if (offsetMap.length < 5) return null;

  const normalizedText = normalizeAudiobookMatchText(originalText);
  if (normalizedText.length < 5) return null;

  const normalizedLabel = normalizeAudiobookMatchText(label);
  if (normalizedLabel.length < 5) return null;

  const labelWords = new Set(normalizedLabel.split(' ').filter(Boolean));
  if (labelWords.size === 0) return null;

  // Find the matching substring window
  const windowRes = findSubstringWindow(normalizedText, normalizedLabel, labelWords, maxChars);
  if (!windowRes) return null;

  // Map normalized offsets back to original UTF-16 offsets
  const { start, end } = windowRes;
  if (start < 0 || end > offsetMap.length || start >= end) return null;

  const origStart = offsetMap[start]!;

  // Compute exclusive end: one code-unit past the last mapped character
  const lastOrig = offsetMap[end - 1]!;
  const lastCodeUnit = originalText.charCodeAt(lastOrig);
  const charLen = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? 2 : 1;
  const origEnd = lastOrig + charLen;

  // Build the Range
  const range = doc.createRange();
  range.setStart(textNode, origStart);
  range.setEnd(textNode, origEnd);

  // Validate: at least 4 meaningful (non-stop) words
  const rangeText = range.toString();
  const normRange = normalizeAudiobookMatchText(rangeText);
  const meaningful = normRange.split(' ').filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  if (meaningful.length < 4) return null;

  return { range, matchType: windowRes.matchType };
}

interface WordSegment {
  textNode: Text;
  startOffset: number;
  endOffset: number;
  wordText: string;
}

/**
 * Narrows a DOM Range to a ~3-word moving window around the active word.
 *
 * Uses `Intl.Segmenter` (word granularity) to split the range's text into
 * word-like segments, maps `progress` (0–1) to a word index, and returns a
 * new Range covering `[activeIdx - 1, activeIdx + 2)`.
 *
 * Returns null when `Intl.Segmenter` is unavailable, fewer than 3 word-like
 * segments exist, or offset mapping fails — callers fall back to the original
 * phrase-level range.
 */
function narrowRangeToWordWindow(
  range: Range,
  doc: Document,
  progress: number,
): { range: Range; activeWord: number; totalWords: number; windowText: string } | null {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;

  // Collect all text nodes within the range
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node: Text | null = walker.firstChild() as Text | null;
  while (node) {
    if (range.intersectsNode(node)) {
      textNodes.push(node);
    }
    node = walker.nextNode() as Text | null;
  }

  if (textNodes.length === 0) return null;

  // Segment each text node into words
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const segments: WordSegment[] = [];

  for (const tn of textNodes) {
    const fullText = tn.textContent ?? '';
    // Determine the portion of this text node that falls within the range
    const nodeRange = doc.createRange();
    nodeRange.selectNodeContents(tn);
    let startOff = 0;
    let endOff = fullText.length;

    if (range.startContainer === tn) startOff = range.startOffset;
    else if (range.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) {
      // range starts after this node
    }

    if (range.endContainer === tn) endOff = range.endOffset;

    const relevantText = fullText.slice(startOff, endOff);
    if (relevantText.trim().length === 0) continue;

    for (const seg of segmenter.segment(fullText)) {
      // Only consider segments that overlap with the range's portion
      if (seg.index + seg.segment.length <= startOff) continue;
      if (seg.index >= endOff) break;

      if (seg.isWordLike) {
        const segStart = Math.max(seg.index, startOff);
        const segEnd = Math.min(seg.index + seg.segment.length, endOff);
        if (segEnd > segStart) {
          segments.push({
            textNode: tn,
            startOffset: segStart,
            endOffset: segEnd,
            wordText: fullText.slice(segStart, segEnd),
          });
        }
      }
    }
  }

  if (segments.length < 3) return null;

  const totalWords = segments.length;
  const activeWord = Math.min(Math.floor(progress * totalWords), totalWords - 1);
  const startWord = Math.max(0, activeWord - 1);
  const endWord = Math.min(totalWords, activeWord + 2);

  // Build a new Range from the first to last segment in the window
  const newRange = doc.createRange();
  const first = segments[startWord]!;
  const last = segments[endWord - 1]!;
  newRange.setStart(first.textNode, first.startOffset);
  newRange.setEnd(last.textNode, last.endOffset);

  const windowText = segments
    .slice(startWord, endWord)
    .map((s) => s.wordText)
    .join('');

  return { range: newRange, activeWord, totalWords, windowText };
}

/**
 * Multi-block concentric phrase search anchored at the CFI point.
 *
 * Phase        | Search scope                        | Min ratio
 * ------------ | ----------------------------------- | ---------
 * phrase-local | anchor text node only               | 0.30
 * phrase-{loc} | current + adjacent blocks (±2)      | 0.20
 *
 * Adjacent blocks are penalised by distance so a weak match in the
 * current block cannot beat a strong match in the next/previous paragraph.
 *
 * - Distance 1 (immediate adjacent): -0.00 penalty
 * - Distance 2: -0.05 penalty
 * - Forward bias: +0.02 for "next" direction (reading order)
 *
 * Returns the best-matching Range and diagnostics, or null.
 */
function findPhraseRange(
  anchorRange: Range,
  doc: Document,
  label: string,
): {
  range: Range;
  strategy: string;
  score: number;
  candidateCount: number;
  anchorText: string;
  bestLocation: string;
  bestBlockText: string;
  rangeChars: number;
} | null {
  const normLabel = normalizeAudiobookMatchText(label);
  if (normLabel.length < 5) return null;

  const labelWords = new Set(normLabel.split(' ').filter(Boolean));
  if (labelWords.size === 0) return null;

  const startNode = anchorRange.startContainer;
  const anchorTextNode = startNode.nodeType === Node.TEXT_NODE ? (startNode as Text) : null;
  const anchorPreview = (anchorTextNode?.textContent ?? startNode.textContent ?? '')
    .trim()
    .slice(0, 50);

  // ── Phase 1: anchor text node only ──
  if (anchorTextNode) {
    const content = anchorTextNode.textContent ?? '';
    const normContent = normalizeAudiobookMatchText(content);
    const contentWords = new Set(normContent.split(' ').filter(Boolean));
    let overlap = 0;
    for (const w of labelWords) {
      if (contentWords.has(w)) overlap++;
    }
    const ratio = overlap / labelWords.size;
    if (ratio >= 0.3 && overlap >= 2) {
      const subResult = createSubstringRange(doc, anchorTextNode, label, 180);
      if (subResult) {
        return {
          range: subResult.range,
          strategy: subResult.matchType === 'exact' ? 'exact-local' : 'fuzzy-local',
          score: Math.round(ratio * 1000) / 1000,
          candidateCount: 1,
          anchorText: anchorPreview,
          bestLocation: 'current',
          bestBlockText: '',
          rangeChars: subResult.range.toString().length,
        };
      }
      // Fallback to full text node
      const r = createTextNodeRange(doc, anchorTextNode);
      return {
        range: r,
        strategy: 'phrase-local',
        score: Math.round(ratio * 1000) / 1000,
        candidateCount: 1,
        anchorText: anchorPreview,
        bestLocation: 'current',
        bestBlockText: '',
        rangeChars: r.toString().length,
      };
    }
  }

  // ── Phase 2: multi-block search (current + adjacent) ──
  const anchorBlock = findBlockElement(startNode);
  if (!anchorBlock) return null;

  const allCandidates: BlockCandidate[] = [];

  // Current block
  const currentBest = findBestInSubtree(anchorBlock, labelWords, anchorTextNode, 0.2);
  if (currentBest && currentBest.overlap >= 2) {
    allCandidates.push({
      node: currentBest.node,
      overlap: currentBest.overlap,
      rawRatio: currentBest.ratio,
      adjustedRatio: currentBest.ratio,
      location: 'current',
      blockElement: anchorBlock,
    });
  }

  // Adjacent blocks
  const adjacent = getAdjacentBlocks(anchorBlock, 2);
  for (const { element, direction, distance } of adjacent) {
    const best = findBestInSubtree(element, labelWords, null, 0.2);
    if (best && best.overlap >= 2) {
      // Distance penalty: blocks further away need stronger matches
      const distPenalty = (distance - 1) * 0.05;
      // Forward bias: slight preference for next over prev at equal scores
      const forwardBias = direction === 'next' ? 0.02 : 0;
      const adjustedRatio = best.ratio - distPenalty + forwardBias;
      allCandidates.push({
        node: best.node,
        overlap: best.overlap,
        rawRatio: best.ratio,
        adjustedRatio,
        location: `${direction}-${distance}`,
        blockElement: element,
      });
    }
  }

  if (allCandidates.length === 0) return null;

  // Pick the candidate with the highest adjusted ratio
  allCandidates.sort((a, b) => b.adjustedRatio - a.adjustedRatio);
  const winner = allCandidates[0]!;

  const location = winner.location;
  const blockText = (winner.blockElement.textContent ?? '').trim().slice(0, 60);

  // Try substring-precise range first
  const subResult = createSubstringRange(doc, winner.node, label, 180);
  if (subResult) {
    const prefix = subResult.matchType === 'exact' ? 'exact' : 'fuzzy';
    const locSuffix = location === 'current' ? 'current' : location;
    return {
      range: subResult.range,
      strategy: `${prefix}-${locSuffix}`,
      score: Math.round(winner.rawRatio * 1000) / 1000,
      candidateCount: allCandidates.length,
      anchorText: anchorPreview,
      bestLocation: location,
      bestBlockText: blockText,
      rangeChars: subResult.range.toString().length,
    };
  }

  // Fallback to full text node
  const r = createTextNodeRange(doc, winner.node);
  const phrasePrefix = location === 'current' ? 'phrase-current' : `phrase-${location}`;
  return {
    range: r,
    strategy: phrasePrefix,
    score: Math.round(winner.rawRatio * 1000) / 1000,
    candidateCount: allCandidates.length,
    anchorText: anchorPreview,
    bestLocation: location,
    bestBlockText: blockText,
    rangeChars: r.toString().length,
  };
}

/**
 * Resolves a CFI to a DOM Range, stamps the live reading marker overlay onto
 * it, and scrolls the view to keep it visible.  Both TTS and audiobook sync
 * call this so exactly one marker is ever shown at a time.
 *
 * Returns a status so callers can handle section mismatches:
 * - 'applied' — marker was placed in the current visible section
 * - 'wrong-section' — the CFI belongs to a different section; caller should
 *   navigate there first
 * - 'error' — the CFI could not be resolved, content not found, or overlayer
 *   was missing
 */
export function applyLiveMarker(
  view: FoliateView,
  cfi: string,
  options: LiveMarkerOptions,
  scrollSettings: ScrollSettings,
  label?: string,
  progress?: number,
): MarkerResult {
  const contents = view.renderer.getContents();
  const primaryIndex = view.renderer.primaryIndex;
  const content = (contents.find((x) => x.index === primaryIndex) ?? contents[0]) as
    | { doc: Document; index?: number; overlayer?: unknown }
    | undefined;
  if (!content) {
    console.warn('[LiveMarker] FAIL — no renderer content', {
      contentsLen: contents.length,
      primaryIndex,
    });
    return { status: 'error', reason: 'no renderer content' };
  }

  const { doc, index: viewSectionIndex, overlayer } = content;

  let anchor: (doc: Document) => Range;
  let cfiSectionIndex: number;
  try {
    ({ anchor, index: cfiSectionIndex } = view.resolveCFI(cfi));
    console.log('[LiveMarker] CFI resolved', {
      cfi: cfi.slice(0, 60),
      cfiSectionIndex,
      viewSectionIndex,
    });
  } catch (err) {
    console.warn('[LiveMarker] FAIL — CFI resolution threw', {
      cfi: cfi.slice(0, 60),
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'error', reason: 'CFI resolution failed' };
  }

  if (viewSectionIndex !== cfiSectionIndex) {
    console.log('[LiveMarker] WRONG SECTION', {
      viewSection: viewSectionIndex,
      cfiSection: cfiSectionIndex,
    });
    return { status: 'wrong-section', cfiSectionIndex };
  }

  let range: Range;
  try {
    range = anchor(doc);
  } catch (err) {
    console.warn('[LiveMarker] FAIL — anchor(doc) threw', {
      cfi: cfi.slice(0, 60),
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'error', reason: 'anchor(doc) failed' };
  }

  // Many CFIs in sync-map entries resolve to a single character offset
  // (e.g. epubcfi(/6/20!/4,/30,/30)) rather than a text span.  A
  // collapsed range produces zero client rects, so the overlayer creates
  // an empty SVG group — the overlay is "applied" but invisible.
  //
  // Expansion tiers, tried in order:
  //   phrase-local  – anchor's own text node matches the transcript label
  //   phrase-block  – best text node within the containing block element
  //   text-node     – expand to the anchor's text node (no label / label didn't match)
  //   block         – expand to the containing block element (last resort)
  if (range.collapsed || range.toString().trim().length === 0) {
    let expanded: Range | null = null;
    let strategy = '';
    let phraseScore: number | undefined;
    let candidateCount: number | undefined;
    let anchorTextPreview: string | undefined;

    // Tier 1–2: phrase-level matching anchored at the CFI point
    let bestLocation: string | undefined;
    let bestBlockText: string | undefined;
    let rangeChars: number | undefined;
    if (label) {
      const result = findPhraseRange(range, doc, label);
      if (result) {
        expanded = result.range;
        strategy = result.strategy;
        phraseScore = result.score;
        candidateCount = result.candidateCount;
        anchorTextPreview = result.anchorText;
        bestLocation = result.bestLocation;
        bestBlockText = result.bestBlockText;
        rangeChars = result.rangeChars;
      }
    }

    // Tier 3: expand to enclosing text node
    if (!expanded) {
      const startNode = range.startContainer;
      if (startNode.nodeType === Node.TEXT_NODE && startNode.textContent) {
        expanded = createTextNodeRange(doc, startNode as Text);
        strategy = 'text-node-fallback';
        anchorTextPreview = (startNode.textContent ?? '').trim().slice(0, 50);
      }
    }

    // Tier 4: expand to containing block element
    if (!expanded) {
      const block = findBlockElement(range.startContainer);
      if (block && (block.textContent?.trim().length ?? 0) > 0) {
        expanded = doc.createRange();
        expanded.selectNodeContents(block);
        strategy = 'block-fallback';
      }
    }

    if (expanded) {
      console.log(`[LiveMarker] Expanded collapsed CFI range (${strategy})`, {
        cfi: cfi.slice(0, 60),
        labelPreview: label?.slice(0, 50),
        strategy,
        score: phraseScore,
        candidateCount,
        bestLocation,
        bestBlockText,
        anchorTextPreview,
        expandedText: expanded.toString().slice(0, 70),
        rangeChars: rangeChars ?? expanded.toString().length,
        rectCount: expanded.getClientRects().length,
      });
      range = expanded;
    } else {
      console.warn('[LiveMarker] FAIL — collapsed range could not be expanded', {
        cfi: cfi.slice(0, 60),
        startContainer: range.startContainer.nodeName,
        hadLabel: !!label,
      });
      return { status: 'error', reason: 'CFI resolved to empty range, expansion failed' };
    }
  }

  // ── Progressive word-window narrowing (audiobook sync only) ──
  // Save the phrase-level range before narrowing so we can render a subtle
  // context layer behind the active-word highlight.
  const phraseRange = range;
  let wordWindowInfo: { activeWord: number; totalWords: number; windowText: string } | null = null;
  if (progress !== undefined && progress >= 0) {
    const narrowed = narrowRangeToWordWindow(range, doc, progress);
    if (narrowed) {
      wordWindowInfo = {
        activeWord: narrowed.activeWord,
        totalWords: narrowed.totalWords,
        windowText: narrowed.windowText,
      };
      console.log('[LiveMarker] Word-window narrowed', {
        activeWord: narrowed.activeWord,
        totalWords: narrowed.totalWords,
        progress: Math.round(progress * 1000) / 1000,
        windowText: narrowed.windowText,
      });
      range = narrowed.range;
    }
  }

  if (!overlayer) {
    console.warn('[LiveMarker] FAIL — overlayer missing on content');
    return { status: 'error', reason: 'overlayer missing on content' };
  }

  const { style, color } = options;

  const ol = overlayer as Overlayer;
  const svg = ol.element as unknown as HTMLElement;

  // ── Layer 1: subtle phrase context (underlay) ──
  svg.style.setProperty('--overlayer-highlight-opacity', '0.16');
  svg.style.setProperty('--overlayer-highlight-blend-mode', 'normal');

  ol.remove(LIVE_MARKER_KEY);
  ol.add(LIVE_MARKER_KEY, phraseRange, Overlayer[style], {
    color,
    padding: 2,
    radius: 4,
  });
  // Lock the inline style so the next layer's CSS-var change doesn't affect this one
  const phraseG = svg.lastElementChild as HTMLElement | null;
  if (phraseG) {
    phraseG.style.opacity = '0.16';
    phraseG.style.mixBlendMode = 'normal';
  }

  // ── Layer 2: active-word highlight (dominant visual) ──
  // Only render when word-window narrowing succeeded.  If narrowing failed
  // (e.g. too few words, progress unavailable), skip the word layer entirely
  // so we never flash a full-paragraph highlight at full opacity.
  let wordRangeForLog: string | undefined;
  if (wordWindowInfo) {
    svg.style.setProperty('--overlayer-highlight-opacity', '0.52');
    svg.style.setProperty('--overlayer-highlight-blend-mode', 'screen');

    ol.remove(LIVE_MARKER_WORD_KEY);
    ol.add(LIVE_MARKER_WORD_KEY, range, Overlayer[style], {
      color,
      padding: 3,
      radius: 4,
    });
    const wordG = svg.lastElementChild as HTMLElement | null;
    if (wordG) {
      wordG.style.opacity = '0.52';
      wordG.style.mixBlendMode = 'screen';
    }
    wordRangeForLog = range.toString().slice(0, 60);
  } else {
    // No word-level narrowing possible — clean up any previous word layer
    ol.remove(LIVE_MARKER_WORD_KEY);
    if (progress !== undefined) {
      console.log('[LiveMarker] Word-window skipped — narrowing returned null, phrase-only');
    }
  }

  const clientRects = range.getClientRects();
  console.log('[LiveMarker] Dual-layer overlay applied', {
    style,
    color,
    phraseChars: phraseRange.toString().length,
    wordChars: wordRangeForLog?.length ?? 0,
    activeWord: wordWindowInfo?.activeWord,
    totalWords: wordWindowInfo?.totalWords,
    rectCount: clientRects.length,
    firstRect:
      clientRects.length > 0
        ? {
            w: clientRects[0]!.width.toFixed(1),
            h: clientRects[0]!.height.toFixed(1),
          }
        : null,
  });

  if (!view.renderer.scrolled) {
    view.renderer.scrollToAnchor?.(range);
  } else {
    const rect = range.getBoundingClientRect();
    const { start, end, sideProp } = view.renderer;
    const rangeTop = rect[sideProp === 'height' ? 'y' : 'x'];
    const rangeBottom = rangeTop + rect[sideProp === 'height' ? 'height' : 'width'];
    const { showHeader, showFooter, showBarsOnScroll, scrollingOverlap } = scrollSettings;
    const headerScrollOverlap = showHeader && showBarsOnScroll ? 44 : 0;
    const footerScrollOverlap = showFooter && showBarsOnScroll ? 44 : 0;
    const outOfView =
      rangeBottom > end - footerScrollOverlap - scrollingOverlap ||
      rangeTop < start + headerScrollOverlap + scrollingOverlap;
    if (outOfView) {
      view.renderer.scrollToAnchor?.(range);
    }
  }

  console.log('[LiveMarker] Overlay APPLIED successfully');
  return { status: 'applied' };
}

/** Removes the live reading marker from the primary view content. */
export function clearLiveMarker(view: FoliateView): void {
  const contents = view.renderer.getContents();
  const primaryIndex = view.renderer.primaryIndex;
  const content = (contents.find((x) => x.index === primaryIndex) ?? contents[0]) as
    | { overlayer?: unknown }
    | undefined;
  const ol = content?.overlayer as Overlayer | undefined;
  ol?.remove(LIVE_MARKER_KEY);
  ol?.remove(LIVE_MARKER_WORD_KEY);
}
