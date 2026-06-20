import { TTSHighlightOptions } from '@/services/tts/types';

// Detail payload for the app-bus `tts-speak` event (see useTTSControl.handleTTSSpeak,
// which honors a passed `range` + `index`). Paragraph mode starts audio from the
// focused paragraph so the listener and the highlighted paragraph stay aligned.
// Mirrors rsvpTts.ts (decision 5, #3235).
export interface ParagraphTtsSpeakDetail {
  bookKey: string;
  // Section spine index of the focused paragraph — starts TTS in the right section.
  index?: number;
  // Live DOM range of the focused paragraph — starts TTS at the exact paragraph.
  // Omitted when there is no range or the range is stale (its document no longer
  // matches the current content), so TTS falls back to its own start position.
  range?: Range;
}

// Build the `tts-speak` detail for "start audio from the focused paragraph"
// (#3235). Returns `{ bookKey }` only when there is nothing to align to.
//
// Start-alignment rules (mirror buildRsvpTtsSpeakDetail):
//   - index = the paragraph's spine index (when known), so audio begins in the
//     focused section even if the range can't be used.
//   - range is included ONLY when it is live: it exists and its ownerDocument is
//     the document paragraph mode is currently rendering (`currentDoc`). A stale
//     or cross-document range would resolve to the wrong place, so it is dropped
//     and TTS falls back to its own start position.
export const buildParagraphTtsSpeakDetail = (
  range: Range | null | undefined,
  docIndex: number | undefined,
  bookKey: string,
  currentDoc: Document | null | undefined,
): ParagraphTtsSpeakDetail => {
  const detail: ParagraphTtsSpeakDetail = { bookKey };

  if (typeof docIndex === 'number') {
    detail.index = docIndex;
  }

  if (range && currentDoc && range.startContainer.ownerDocument === currentDoc) {
    detail.range = range;
  }

  return detail;
};

// Character offsets of a spoken word/sentence range relative to the start of the
// focused paragraph's text (#3235). Paragraph mode renders a CLONE of the
// paragraph in the overlay, so the iframe's TTS highlight isn't visible there;
// the overlay re-creates it from these offsets (which map 1:1 onto the clone's
// text content because both the clone and these offsets start at the paragraph
// start). Returns null when the target isn't inside the paragraph or is empty.
export const computeParagraphHighlightOffsets = (
  paragraphRange: Range,
  targetRange: Range,
): { start: number; end: number } | null => {
  try {
    const doc = paragraphRange.startContainer.ownerDocument;
    if (!doc) return null;
    // The target must begin within the paragraph; isPointInRange returns false
    // (no throw) for points before/after the range or in a different root.
    if (!paragraphRange.isPointInRange(targetRange.startContainer, targetRange.startOffset)) {
      return null;
    }
    const pre = doc.createRange();
    pre.setStart(paragraphRange.startContainer, paragraphRange.startOffset);
    pre.setEnd(targetRange.startContainer, targetRange.startOffset);
    const start = pre.toString().length;
    const length = targetRange.toString().length;
    if (length <= 0) return null;
    return { start, end: start + length };
  } catch {
    return null;
  }
};

export type ParagraphTtsHighlightAction = 'word' | 'sentence' | 'skip';

// Decide what to highlight for a `tts-position` event (#3235). Edge TTS emits
// BOTH a per-sentence mark and per-word boundaries; once words have been seen we
// keep the fine-grained word highlight and skip the coarse sentence event so the
// whole sentence doesn't flicker over the current word. Engines without word
// boundaries (WebSpeech/Native) only emit sentence events → sentence highlight.
export const decideParagraphTtsHighlight = (input: {
  kind?: 'word' | 'sentence';
  hasWordPositions: boolean;
}): ParagraphTtsHighlightAction => {
  if (input.kind === 'word') return 'word';
  if (input.hasWordPositions) return 'skip';
  return 'sentence';
};

// CSS declaration body for the overlay's `::highlight()` rule, derived from the
// user's TTS highlight options so the in-paragraph highlight matches normal mode
// (#3235). The CSS Custom Highlight pseudo only supports a handful of properties
// (background-color, text-decoration, color, …), so styles map onto those:
//   - highlight/outline → a translucent background of the chosen color
//   - underline/squiggly/strikethrough → a text-decoration in the chosen color
export const buildTtsHighlightCssText = (options?: TTSHighlightOptions): string => {
  const color = options?.color || '#808080';
  switch (options?.style) {
    case 'underline':
      return `text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: 2px; text-underline-offset: 2px;`;
    case 'squiggly':
      return `text-decoration: underline wavy; text-decoration-color: ${color};`;
    case 'strikethrough':
      return `text-decoration: line-through; text-decoration-color: ${color};`;
    case 'highlight':
    case 'outline':
    default:
      return `background-color: color-mix(in srgb, ${color} 40%, transparent);`;
  }
};
