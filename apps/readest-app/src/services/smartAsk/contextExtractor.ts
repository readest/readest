import { TextSelection } from '@/utils/sel';

/**
 * Extracts surrounding text context from the reader DOM around the given selection.
 *
 * For EPUB/reflowable formats: walks sibling block-level nodes in the same
 * document as the selection range, collecting text until maxChars is reached.
 *
 * For fixed-layout (PDF): falls back to the selected text only.
 */
export function extractContext(selection: TextSelection, maxChars: number): string {
  const { text, range } = selection;

  if (!range) {
    return text;
  }

  try {
    const doc = range.startContainer.ownerDocument;
    if (!doc) return text;

    // Find the nearest block-level ancestor of the selection start
    const startBlock = findBlockAncestor(range.startContainer);
    if (!startBlock) return text;

    const halfChars = Math.floor(maxChars / 2);
    const before = collectTextBefore(startBlock, halfChars);
    const after = collectTextAfter(startBlock, halfChars);

    const parts: string[] = [];
    if (before) parts.push(before);
    parts.push(`[Selected: ${text}]`);
    if (after) parts.push(after);

    return parts.join('\n');
  } catch {
    return text;
  }
}

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'FIGCAPTION',
  'CAPTION',
]);

function findBlockAncestor(node: Node): Element | null {
  let current: Node | null = node;
  while (current && current.nodeType !== Node.DOCUMENT_NODE) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      if (BLOCK_TAGS.has(el.tagName)) {
        return el;
      }
    }
    current = current.parentNode;
  }
  return null;
}

function collectTextBefore(startEl: Element, maxChars: number): string {
  const chunks: string[] = [];
  let collected = 0;
  let el: Element | null = startEl.previousElementSibling;

  while (el && collected < maxChars) {
    const t = el.textContent || '';
    if (t.trim()) {
      chunks.unshift(t.trim());
      collected += t.length;
    }
    el = el.previousElementSibling;
  }

  const joined = chunks.join('\n');
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
}

function collectTextAfter(startEl: Element, maxChars: number): string {
  const chunks: string[] = [];
  let collected = 0;
  let el: Element | null = startEl.nextElementSibling;

  while (el && collected < maxChars) {
    const t = el.textContent || '';
    if (t.trim()) {
      chunks.push(t.trim());
      collected += t.length;
    }
    el = el.nextElementSibling;
  }

  const joined = chunks.join('\n');
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}
