import { INLINE_FORMATTING_TAGS, isInlineFormattingTag } from '@/utils/inlineTags';

/**
 * Carrying a paragraph's inline formatting through translation (#1582).
 *
 * The translator is what maps formatting onto the translated wording — send it
 * `The <b>quick</b> brown fox` and Bing returns `那只<b>敏捷</b>的棕色狐狸`, with
 * the tag on the semantically matching word even though the sentence reordered.
 * We therefore round-trip markup rather than trying to re-align runs ourselves.
 *
 * The response is untrusted markup that ends up inside the book's DOM, so it is
 * parsed detached and rebuilt through an allowlist — never assigned as
 * innerHTML. Attributes use *echo validation*: an attribute survives only if
 * that exact tag/name/value appeared in the source we sent. That keeps book
 * styling hooks like `<span class="whisper">` (the small-font case in #1582)
 * while making it impossible for the response to introduce a class, href, style
 * or handler of its own.
 */

/** Attributes worth preserving; anything else is dropped outright. */
const PRESERVABLE_ATTRS = ['class', 'href', 'lang', 'dir'] as const;

/**
 * Runtime-injected content that is not part of the book: translation targets,
 * a11y skip links, and WordLens ruby glosses. It must never be fed to the
 * translator (a gloss would come back translated as if it were prose).
 */
const INJECTED_SELECTOR = '.translation-target, [cfi-inert]';
const GLOSS_SELECTOR = 'ruby.wl-gloss, .wl-gloss';

export interface SourcePayload {
  /** Serialized inline markup, empty when the source is plain text. */
  html: string;
  /** Plain-text form, always populated — the fallback payload. */
  text: string;
  /** True when the source carries inline markup worth round-tripping. */
  hasMarkup: boolean;
  /** Echo-validation set of `tag|name|value` triples seen in the source. */
  allowedAttrs: Set<string>;
}

const attrKey = (tag: string, name: string, value: string) =>
  `${tag.toLowerCase()}|${name.toLowerCase()}|${value}`;

/**
 * Strips runtime-injected nodes from a detached clone of `el`, so what we send
 * is the book's own markup and nothing else.
 */
const cleanClone = (el: HTMLElement): HTMLElement => {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(INJECTED_SELECTOR).forEach((node) => node.remove());
  // A gloss wraps real book text: keep the base text, drop the injected reading.
  clone.querySelectorAll(GLOSS_SELECTOR).forEach((gloss) => {
    gloss.querySelectorAll('rt, rp').forEach((node) => node.remove());
    gloss.replaceWith(...Array.from(gloss.childNodes));
  });
  return clone;
};

export const extractSourcePayload = (el: HTMLElement): SourcePayload => {
  const clone = cleanClone(el);
  const text = clone.textContent ?? '';

  const allowedAttrs = new Set<string>();
  let hasMarkup = false;
  for (const descendant of Array.from(clone.querySelectorAll('*'))) {
    const tag = descendant.tagName.toLowerCase();
    if (isInlineFormattingTag(tag)) {
      hasMarkup = true;
      for (const name of PRESERVABLE_ATTRS) {
        const value = descendant.getAttribute(name);
        if (value !== null) allowedAttrs.add(attrKey(tag, name, value));
      }
    }
  }

  return { html: hasMarkup ? clone.innerHTML : '', text, hasMarkup, allowedAttrs };
};

/**
 * Rebuilds the translator's response as a detached fragment containing only
 * allowlisted inline tags and echo-validated attributes. Disallowed elements
 * are unwrapped so their text is never lost. Returns null when nothing
 * meaningful survives, so callers can fall back to the plain-text path.
 */
export const sanitizeTranslatedMarkup = (
  html: string,
  allowedAttrs: Set<string>,
  doc: Document = document,
): DocumentFragment | null => {
  // Parsed in a detached document: no scripts run, no resources are fetched,
  // and unbalanced tags are normalized by the parser.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = doc.createDocumentFragment();

  const convert = (source: Node, target: Node) => {
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(doc.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue; // comments, CDATA, …

      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (!isInlineFormattingTag(tag)) {
        // Unwrap: drop the tag, keep its text.
        convert(element, target);
        continue;
      }

      const rebuilt = doc.createElement(tag);
      for (const name of PRESERVABLE_ATTRS) {
        const value = element.getAttribute(name);
        if (value !== null && allowedAttrs.has(attrKey(tag, name, value))) {
          rebuilt.setAttribute(name, value);
        }
      }
      convert(element, rebuilt);
      target.appendChild(rebuilt);
    }
  };

  convert(parsed.body, fragment);

  return (fragment.textContent ?? '').trim() ? fragment : null;
};

/** Tags the sanitizer will keep — exported for tests and documentation. */
export const SANITIZER_ALLOWED_TAGS = INLINE_FORMATTING_TAGS;

interface Ancestor {
  tag: string;
  attrs: Array<[string, string]>;
}

/** A stretch of text together with the inline elements enclosing it. */
interface Run {
  text: string;
  ancestors: Ancestor[];
}

const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const openTag = ({ tag, attrs }: Ancestor) =>
  attrs.length
    ? `<${tag} ${attrs.map(([name, value]) => `${name}="${escapeAttr(value)}"`).join(' ')}>`
    : `<${tag}>`;

const sameAncestor = (a: Ancestor, b: Ancestor) =>
  a.tag === b.tag &&
  a.attrs.length === b.attrs.length &&
  a.attrs.every(([name, value], i) => b.attrs[i]?.[0] === name && b.attrs[i]?.[1] === value);

/** Flattens an element into text runs, each tagged with its inline ancestors. */
const collectRuns = (root: Node): Run[] => {
  const runs: Run[] = [];
  const visit = (node: Node, ancestors: Ancestor[]) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text) runs.push({ text, ancestors });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (!isInlineFormattingTag(tag)) {
        visit(element, ancestors); // unwrap: keep the text, drop the tag
        continue;
      }
      const attrs = PRESERVABLE_ATTRS.map(
        (name) => [name, element.getAttribute(name)] as [string, string | null],
      ).filter((pair): pair is [string, string] => pair[1] !== null);
      visit(element, [...ancestors, { tag, attrs }]);
    }
  };
  visit(root, []);
  return runs;
};

/** Serializes runs into well-formed HTML, opening each tag only once. */
const serializeRuns = (runs: Run[]): string => {
  let html = '';
  let open: Ancestor[] = [];
  for (const run of runs) {
    let shared = 0;
    while (
      shared < open.length &&
      shared < run.ancestors.length &&
      sameAncestor(open[shared]!, run.ancestors[shared]!)
    ) {
      shared++;
    }
    for (let i = open.length - 1; i >= shared; i--) html += `</${open[i]!.tag}>`;
    for (let i = shared; i < run.ancestors.length; i++) html += openTag(run.ancestors[i]!);
    html += escapeText(run.text);
    open = run.ancestors;
  }
  for (let i = open.length - 1; i >= 0; i--) html += `</${open[i]!.tag}>`;
  return html;
};

/**
 * Splits a paragraph's inline markup into chunks that each fit `maxChars`
 * *including their tags*, and that are each well-formed on their own.
 *
 * Formatting that straddles a boundary is re-opened in the next chunk, so an
 * <i> spanning the split becomes two <i> elements — visually identical, and it
 * keeps every chunk independently translatable. Without this, a formatted
 * paragraph over the provider's cap had to fall back to plain text and lose its
 * formatting entirely (#1582); the plain-text chunker splits on sentence
 * boundaries and would cut through a tag.
 *
 * Returns an empty array when the markup cannot be chunked (a single tag's own
 * overhead exceeds the budget), so callers fall back to the plain-text path.
 */
export const splitMarkupIntoChunks = (
  html: string,
  maxChars: number,
  splitLongText: (text: string, maxLength: number) => string[],
): string[] => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const runs = collectRuns(parsed.body);
  if (!runs.length) return [];

  const chunks: string[] = [];
  let current: Run[] = [];

  const flush = () => {
    if (!current.length) return;
    chunks.push(serializeRuns(current));
    current = [];
  };

  for (const run of runs) {
    // Budget left for this run's text once its wrappers are accounted for.
    const overhead = serializeRuns([{ text: '', ancestors: run.ancestors }]).length;
    if (overhead >= maxChars) return [];

    let remaining = run.text;
    while (remaining) {
      const projected = serializeRuns([...current, { text: remaining, ancestors: run.ancestors }]);
      if (projected.length <= maxChars) {
        current.push({ text: remaining, ancestors: run.ancestors });
        break;
      }
      const budget = maxChars - serializeRuns(current).length - overhead;
      // Not enough room left in this chunk to say anything useful — close it.
      if (budget <= 0 || (current.length && budget < remaining.length / 4)) {
        flush();
        continue;
      }
      const [head, ...rest] = splitLongText(remaining, budget);
      if (!head) {
        if (!current.length) return [];
        flush();
        continue;
      }
      current.push({ text: head, ancestors: run.ancestors });
      remaining = rest.join('');
      flush();
    }
  }
  flush();

  return chunks.every((chunk) => chunk.length <= maxChars) ? chunks : [];
};
