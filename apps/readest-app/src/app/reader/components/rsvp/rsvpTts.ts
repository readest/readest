import { RsvpWord } from '@/services/rsvp';

// Detail payload for the app-bus `tts-speak` event (see useTTSControl.handleTTSSpeak,
// which honors a passed `range` + `index`). RSVP starts audio from the displayed
// word so the listener and the flashing word stay aligned.
export interface RsvpTtsSpeakDetail {
  bookKey: string;
  // Section spine index of the displayed word — starts TTS in the right section.
  index?: number;
  // Live DOM range of the displayed word — starts TTS at the exact word. Omitted
  // when the word has no range or the range is stale (its document no longer
  // matches the current content), so TTS falls back to its own start position.
  range?: Range;
}

// Build the `tts-speak` detail for "start audio from the current RSVP word"
// (decision 5, #3235). Returns null when there is no current word to align to.
//
// Start-alignment rules:
//   - index = the word's spine index (when known), so audio begins in the
//     displayed section even if the range can't be used.
//   - range is included ONLY when it is live: it exists and its ownerDocument is
//     the document RSVP is currently rendering (`currentDoc`). A stale or
//     cross-document range would resolve to the wrong place, so it is dropped and
//     TTS falls back to its own start position.
export const buildRsvpTtsSpeakDetail = (
  currentWord: RsvpWord | null | undefined,
  bookKey: string,
  currentDoc: Document | null | undefined,
): RsvpTtsSpeakDetail | null => {
  if (!currentWord) return null;

  const detail: RsvpTtsSpeakDetail = { bookKey };

  if (typeof currentWord.docIndex === 'number') {
    detail.index = currentWord.docIndex;
  }

  const range = currentWord.range;
  if (range && currentDoc && range.startContainer.ownerDocument === currentDoc) {
    detail.range = range;
  }

  return detail;
};
