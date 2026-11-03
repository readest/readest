import { describe, expect, it } from 'vitest';
import { sentenceAt } from '@/services/vocabulary/sentence';

// The sentence saved with a lookup comes from the selection's own block, with
// the spacing around the word kept (found in real use: the shared context
// helper trims each side and reaches into the previous block).

const rangeOver = (doc: Document, word: string) => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = n.textContent!.indexOf(word);
    if (at >= 0) {
      const range = doc.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + word.length);
      return range;
    }
  }
  throw new Error(`no ${word}`);
};

const docOf = (html: string) => {
  const doc = document.implementation.createHTMLDocument('t');
  doc.body.innerHTML = html;
  return doc;
};

describe('sentenceAt', () => {
  it('keeps the spaces around the word and stays inside its paragraph', () => {
    const doc = docOf(
      '<h1>Chapter One</h1><p>It was pure serendipity that we met in Lisbon. Captain Nemo smiled.</p>',
    );
    expect(sentenceAt(rangeOver(doc, 'serendipity'))).toBe(
      'It was pure serendipity that we met in Lisbon.',
    );
  });

  it('reads across inline markup', () => {
    const doc = docOf('<p>He said <em>nothing</em> at all. Then <b>Nemo</b> left.</p>');
    expect(sentenceAt(rangeOver(doc, 'Nemo'))).toBe('Then Nemo left.');
  });

  it('leaves out ruby annotations such as Word Lens hints and furigana', () => {
    const doc = docOf(
      '<p>Captain Nemo smiled at the note <ruby class="wl-gloss">and<rt>和</rt></ruby> said nothing.</p>',
    );
    expect(sentenceAt(rangeOver(doc, 'Nemo'))).toBe(
      'Captain Nemo smiled at the note and said nothing.',
    );
  });

  it('works for text without spaces', () => {
    const doc = docOf('<p>他走了。我们必须斟酌这件事！然后呢</p>');
    expect(sentenceAt(rangeOver(doc, '斟酌'))).toBe('我们必须斟酌这件事！');
  });
});
