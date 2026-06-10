import { sanitizeHtml } from '@/utils/sanitize';
import type { OPDSContent } from '@/types/opds';

/**
 * Decode one level of HTML entities, e.g. `&lt;p&gt;` -> `<p>`. Used to recover
 * HTML markup that a feed escaped one extra time (see below).
 */
const decodeEntities = (text: string): string => {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc.documentElement.textContent ?? '';
};

/**
 * Turn an OPDS publication description/content value into sanitized HTML ready
 * for `dangerouslySetInnerHTML` (issue #4503).
 *
 * Feeds deliver summaries in several shapes:
 *  - `type="html"`/`"xhtml"`, or `type="text"` holding single-escaped HTML:
 *    the value already contains real markup, so it renders as-is.
 *  - `type="text"` holding *double*-escaped HTML: some aggregators escape an
 *    already-escaped summary, so the markup survives parsing as entity *text*
 *    (`&lt;p&gt;...`) and previously showed literal `<p>`/`&quot;` tags. When
 *    the value is entirely escaped markup (no real tags), decode it one extra
 *    level so it renders as HTML — matching what other readers (e.g. Thorium)
 *    show. Mixed content like `<p>see &lt;code&gt;</p>` is left untouched so an
 *    intentionally-escaped tag still displays literally.
 *
 * Every branch is sanitized to strip scripts and other unsafe markup from this
 * untrusted, remote feed content.
 */
export const getOPDSDescriptionHtml = (content: OPDSContent | string | undefined): string => {
  const raw = typeof content === 'string' ? content : content?.value;
  if (!raw) return '';
  const hasEscapedTags = /&lt;\/?[a-z]/i.test(raw);
  const hasRealTags = /<[a-z]/i.test(raw);
  const html = hasEscapedTags && !hasRealTags ? decodeEntities(raw) : raw;
  return sanitizeHtml(html);
};
