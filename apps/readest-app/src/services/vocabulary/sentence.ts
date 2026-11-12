import { extractSentence } from './entry';

const BLOCK_SELECTOR =
  'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, pre, figcaption, div';

const blockOf = (node: Node): Element | null => {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(BLOCK_SELECTOR) ?? element;
};

// A range's text without ruby annotations (Word Lens hints, furigana).
const textOf = (range: Range): string => {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('rt, rp').forEach((el) => el.remove());
  return fragment.textContent ?? '';
};

/**
 * The sentence a selection sits in, read from its own block only and with the
 * text on either side left untrimmed, so the spaces around the word survive.
 */
export const sentenceAt = (range: Range): string => {
  // Runs while rendering the dictionary popup; a range it can't read (e.g. a
  // section remounting under it) gives '' and the caller falls back.
  try {
    const doc = range.startContainer.ownerDocument!;
    const head = doc.createRange();
    const first = blockOf(range.startContainer);
    if (first) head.setStart(first, 0);
    else head.collapse(true);
    head.setEnd(range.startContainer, range.startOffset);
    const tail = doc.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    const last = blockOf(range.endContainer);
    if (last) tail.setEnd(last, last.childNodes.length);
    else tail.collapse(true);
    return extractSentence(textOf(head), textOf(range), textOf(tail));
  } catch (err) {
    console.warn('[vocabulary] could not read the sentence', err);
    return '';
  }
};
