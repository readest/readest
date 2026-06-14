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
