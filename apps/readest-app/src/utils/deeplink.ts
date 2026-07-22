import { READEST_WEB_BASE_URL } from '@/services/constants';

export type AnnotationDeepLink = {
  bookHash: string;
  noteId: string;
  cfi?: string;
};

/**
 * Which form of annotation link markdown export embeds: the custom-scheme
 * `readest://` app deeplink or the universal `https://` web link.
 */
export type AnnotationLinkType = 'app' | 'web';

const ANNOTATION_PATH_PREFIX = '/o/book/';

/**
 * Build the canonical HTTPS URL for an annotation. Used in markdown export
 * and Readwise sync. Mobile App Links (web.readest.com) intercept this URL
 * and open the native app; on desktop browsers it resolves to the smart
 * landing page at /o/book/{hash}/annotation/{id}.
 */
export const buildAnnotationWebUrl = ({ bookHash, noteId, cfi }: AnnotationDeepLink): string => {
  const base = `${READEST_WEB_BASE_URL}${ANNOTATION_PATH_PREFIX}${bookHash}/annotation/${noteId}`;
  return cfi ? `${base}?cfi=${encodeURIComponent(cfi)}` : base;
};

/**
 * Build the custom-scheme URL. Kept as a parallel form for share-sheet flows
 * and direct deeplink scenarios. Markdown export uses the HTTPS form.
 */
export const buildAnnotationAppUrl = ({ bookHash, noteId, cfi }: AnnotationDeepLink): string => {
  const base = `readest://book/${bookHash}/annotation/${noteId}`;
  return cfi ? `${base}?cfi=${encodeURIComponent(cfi)}` : base;
};

/**
 * Build the annotation link for the requested {@link AnnotationLinkType}.
 * `app` yields the custom-scheme deeplink; `web` yields the universal HTTPS form.
 */
export const buildAnnotationUrl = (
  link: AnnotationDeepLink,
  linkType: AnnotationLinkType,
): string => (linkType === 'app' ? buildAnnotationAppUrl(link) : buildAnnotationWebUrl(link));

/**
 * Parse an incoming readest:// or https://web.readest.com annotation URL.
 * Accepts the new hierarchical form (book/{hash}/annotation/{id}) and the
 * legacy flat form (annotation/{hash}/{id}) emitted by older Readwise syncs.
 * Returns null if the URL doesn't match.
 */
export const parseAnnotationDeepLink = (url: string): AnnotationDeepLink | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const isCustomScheme = parsed.protocol === 'readest:';
  const isWebHost =
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.host === 'web.readest.com';
  if (!isCustomScheme && !isWebHost) return null;

  // For readest:// URLs the URL parser stores the first path segment in the
  // host. Reconstruct a uniform segment list across both schemes.
  const segments: string[] = isCustomScheme
    ? [parsed.host, ...parsed.pathname.split('/')].filter(Boolean)
    : parsed.pathname.split('/').filter(Boolean);

  // HTTPS landing page is prefixed with /o/. Strip it for uniform parsing.
  if (isWebHost) {
    if (segments[0] !== 'o') return null;
    segments.shift();
  }

  const cfiParam = parsed.searchParams.get('cfi');
  const cfi = cfiParam ? cfiParam : undefined;

  // Hierarchical: book/{hash}/annotation/{id}
  if (segments.length === 4 && segments[0] === 'book' && segments[2] === 'annotation') {
    return { bookHash: segments[1]!, noteId: segments[3]!, cfi };
  }

  // Legacy flat: annotation/{hash}/{id}
  if (segments.length === 3 && segments[0] === 'annotation') {
    return { bookHash: segments[1]!, noteId: segments[2]!, cfi };
  }

  return null;
};

/**
 * Parse an incoming readest:// or https://web.readest.com book-open URL.
 * Matches only the bare form `book/{hash}` (the widget tap target); the
 * 4-segment annotation form `book/{hash}/annotation/{id}` is handled by
 * parseAnnotationDeepLink and must NOT match here.
 */
export const parseBookDeepLink = (url: string): { bookHash: string; autoplay?: boolean } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const isCustomScheme = parsed.protocol === 'readest:';
  const isWebHost =
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.host === 'web.readest.com';
  if (!isCustomScheme && !isWebHost) return null;

  const segments: string[] = isCustomScheme
    ? [parsed.host, ...parsed.pathname.split('/')].filter(Boolean)
    : parsed.pathname.split('/').filter(Boolean);

  if (isWebHost) {
    if (segments[0] !== 'o') return null;
    segments.shift();
  }

  if (segments.length === 2 && segments[0] === 'book' && segments[1]) {
    // `?autoplay=tts` is appended by the Android Auto cold-resume launch to ask
    // the reader to start read-aloud once the book is open. Only surface the
    // flag when set so the common shape stays `{ bookHash }`.
    if (parsed.searchParams.get('autoplay') === 'tts') {
      return { bookHash: segments[1], autoplay: true };
    }
    return { bookHash: segments[1] };
  }
  return null;
};
