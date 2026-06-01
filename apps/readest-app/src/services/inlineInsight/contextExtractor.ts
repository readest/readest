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
  const selectedText = normalizeText(selection.text);
  const { range } = selection;

  if (!range) {
    return selectedText;
  }

  try {
    const doc = range.startContainer.ownerDocument;
    if (!doc) return selectedText;

    const startBlock = findBlockAncestor(range.startContainer);
    const endBlock = findBlockAncestor(range.endContainer) ?? startBlock;
    if (!startBlock) return selectedText;

    // Split the remaining character budget around the selection so the model sees
    // just enough local context on both sides without pulling in a whole chapter.
    const budget = Math.max(0, maxChars - selectedText.length);
    const beforeBudget = Math.floor(budget / 2);
    const afterBudget = budget - beforeBudget;
    const blocks = collectReadableBlocks(findContextRoot(startBlock));
    const startIndex = findBlockIndex(blocks, startBlock);
    const endIndex = endBlock ? findBlockIndex(blocks, endBlock) : startIndex;

    const currentBefore = getTextBeforeSelection(doc, startBlock, range);
    const currentAfter = endBlock ? getTextAfterSelection(doc, endBlock, range) : '';
    const before = collectBefore(blocks, startIndex, currentBefore, beforeBudget);
    const after = collectAfter(blocks, endIndex, currentAfter, afterBudget);

    const parts: string[] = [];
    if (before) parts.push(`Before:\n${before}`);
    parts.push(`Selected:\n${selectedText}`);
    if (after) parts.push(`After:\n${after}`);

    return parts.join('\n');
  } catch {
    return selectedText;
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

const ROOT_TAGS = new Set(['ARTICLE', 'MAIN', 'BODY']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME']);

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

function findContextRoot(startEl: Element): Element {
  let current: Element | null = startEl;
  let fallback: Element = startEl.ownerDocument.body ?? startEl;

  while (current) {
    if (ROOT_TAGS.has(current.tagName)) return current;
    if (current.tagName === 'SECTION') fallback = current;
    current = current.parentElement;
  }

  return fallback;
}

function collectReadableBlocks(root: Element): Element[] {
  const nodeFilter = root.ownerDocument.defaultView?.NodeFilter ?? NodeFilter;

  const blocks: Element[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, nodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return nodeFilter.FILTER_REJECT;
      if (!BLOCK_TAGS.has(el.tagName)) return nodeFilter.FILTER_SKIP;
      if (!normalizeText(el.textContent ?? '')) return nodeFilter.FILTER_SKIP;
      // Only keep leaf-level readable blocks. Parent containers tend to duplicate the same
      // text as their descendants and make the final context much noisier.
      return hasChildBlock(el) ? nodeFilter.FILTER_SKIP : nodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    blocks.push(current as Element);
    current = walker.nextNode();
  }

  if (blocks.length === 0 && normalizeText(root.textContent ?? '')) {
    blocks.push(root);
  }
  return blocks;
}

function hasChildBlock(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (BLOCK_TAGS.has(child.tagName) || hasChildBlock(child)) {
      return true;
    }
  }
  return false;
}

function findBlockIndex(blocks: Element[], block: Element): number {
  const index = blocks.findIndex((candidate) => candidate === block || candidate.contains(block));
  if (index >= 0) return index;
  return blocks.findIndex((candidate) => block.contains(candidate));
}

function getTextBeforeSelection(doc: Document, startBlock: Element, range: Range): string {
  const beforeRange = doc.createRange();
  beforeRange.selectNodeContents(startBlock);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  return normalizeText(beforeRange.toString());
}

function getTextAfterSelection(doc: Document, endBlock: Element, range: Range): string {
  const afterRange = doc.createRange();
  afterRange.selectNodeContents(endBlock);
  afterRange.setStart(range.endContainer, range.endOffset);
  return normalizeText(afterRange.toString());
}

function collectBefore(
  blocks: Element[],
  startIndex: number,
  currentBefore: string,
  maxChars: number,
): string {
  if (maxChars <= 0) return '';

  const chunks: string[] = [];
  if (currentBefore) chunks.unshift(currentBefore);

  for (let i = startIndex - 1; i >= 0; i--) {
    chunks.unshift(normalizeText(blocks[i]?.textContent ?? ''));
    if (chunks.join('\n').length >= maxChars) break;
  }

  return takeLastChars(chunks.filter(Boolean).join('\n'), maxChars);
}

function collectAfter(
  blocks: Element[],
  endIndex: number,
  currentAfter: string,
  maxChars: number,
): string {
  if (maxChars <= 0) return '';

  const chunks: string[] = [];
  if (currentAfter) chunks.push(currentAfter);

  for (let i = endIndex + 1; i < blocks.length; i++) {
    chunks.push(normalizeText(blocks[i]?.textContent ?? ''));
    if (chunks.join('\n').length >= maxChars) break;
  }

  return takeFirstChars(chunks.filter(Boolean).join('\n'), maxChars);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function takeLastChars(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(text.length - maxChars).trimStart() : text;
}

function takeFirstChars(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars).trimEnd() : text;
}
