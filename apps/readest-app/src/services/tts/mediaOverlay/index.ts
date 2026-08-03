import type { BookDoc } from '@/libs/document';

export { parseSmil, parseSmilClock, type SmilPar } from './parseSmil';
export {
  loadMediaOverlaySection,
  MediaOverlaySection,
  type NarrationPar,
} from './MediaOverlaySection';
export { MediaOverlayTTS } from './MediaOverlayTTS';
export {
  MediaOverlayClient,
  MEDIA_OVERLAY_CLIENT_NAME,
  MEDIA_OVERLAY_VOICE_ID,
} from './MediaOverlayClient';

// Whether this book can be narrated from its own recording: at least one
// section carries a Media Overlay, and the container can hand us the SMIL and
// the audio. Only EPUB satisfies the latter.
export const hasMediaOverlays = (book: BookDoc | null | undefined): boolean =>
  !!book?.loadText &&
  !!book.loadBlob &&
  !!book.sections?.some((section) => section.mediaOverlay?.href);

// Nearest section at or after (direction 1) / at or before (direction -1)
// `from` that has a Media Overlay. Sections without one carry no narration, so
// playback steps over them. Returns -1 when there is none left.
export const findNarratedSection = (book: BookDoc, from: number, direction: 1 | -1): number => {
  const sections = book.sections ?? [];
  for (let i = from; i >= 0 && i < sections.length; i += direction) {
    if (sections[i]?.mediaOverlay?.href) return i;
  }
  return -1;
};
