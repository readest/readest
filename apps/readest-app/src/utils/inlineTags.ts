/**
 * Inline formatting tags — the single source of truth for "this element is a
 * text run, not a block".
 *
 * Two consumers must agree on this set, which is why it lives here:
 *
 * - `getParagraphLayoutStyles()` treats a <div> as paragraph-like only when
 *   every *descendant* is one of these, so a div carrying only inline markup
 *   still gets line-height / indent / spacing overrides.
 * - the translation sanitizer only keeps these tags, so preserved formatting
 *   inside a translation can never contain a tag that would make the enclosing
 *   source div fail the rule above and silently drop its layout.
 *
 * Anything injected into a book paragraph at runtime must use a tag from this
 * list (or be added to it). `<font>` is here both because older EPUBs use it
 * and because Readest's own translation wrapper is a <font>.
 */
export const INLINE_FORMATTING_TAGS = [
  'a',
  'b',
  'em',
  'i',
  'strong',
  'u',
  'span',
  'font',
  'sup',
  'sub',
  'small',
  'mark',
] as const;

export type InlineFormattingTag = (typeof INLINE_FORMATTING_TAGS)[number];

/** Comma-separated form for use inside a CSS selector list. */
export const INLINE_FORMATTING_SELECTOR = INLINE_FORMATTING_TAGS.join(', ');

const tagSet: ReadonlySet<string> = new Set<string>(INLINE_FORMATTING_TAGS);

export const isInlineFormattingTag = (tagName: string): boolean =>
  tagSet.has(tagName.toLowerCase());
