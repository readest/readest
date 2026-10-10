import { describe, expect, test } from 'vitest';
import { getRenderedRunsFromRange, getRenderedTextFromRange } from '@/utils/sel';

// Quote cards (#5830) need the passage as the reader sees it, not the raw DOM text.
const rangeOver = (html: string, from = 0, to?: number) => {
  document.body.innerHTML = `<style>.hidden { display: none; }</style><div id="root">${html}</div>`;
  const root = document.getElementById('root')!;
  const range = document.createRange();
  range.setStart(root, from);
  range.setEnd(root, to ?? root.childNodes.length);
  return range;
};

describe('getRenderedTextFromRange', () => {
  test('collapses source-formatting newlines inside a paragraph', () => {
    const range = rangeOver(
      '<p>\n Acts 8:30\n And<a><img></a>\n\n Philip<a><img></a>\n ran thither</p>' +
        '<p>\n Acts 8:31\n And he said</p>',
    );
    expect(getRenderedTextFromRange(range).trim()).toBe(
      'Acts 8:30 And Philip ran thither\nActs 8:31 And he said',
    );
  });

  test('skips content hidden with display: none, like a toggled-off translation', () => {
    const range = rangeOver(
      '<p>Understandest thou what thou readest?<font class="hidden">你所念的，你明白吗？</font></p>',
    );
    expect(getRenderedTextFromRange(range).trim()).toBe('Understandest thou what thou readest?');
  });

  test('drops ruby annotations and keeps line breaks from <br>', () => {
    const range = rangeOver('<p><ruby>漢<rt>かん</rt></ruby>字<br>second line</p>');
    expect(getRenderedTextFromRange(range).trim()).toBe('漢字\nsecond line');
  });

  test('honours partial text nodes at the range edges', () => {
    document.body.innerHTML = '<p id="p">How can I, except some man should guide me?</p>';
    const text = document.getElementById('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 9);
    expect(getRenderedTextFromRange(range)).toBe('can I');
  });

  test('keeps whitespace in preformatted text', () => {
    const range = rangeOver('<pre>line one\n  line two</pre>');
    expect(getRenderedTextFromRange(range).trim()).toBe('line one\n  line two');
  });

  test('returns bold and italic runs from the computed styles', () => {
    const range = rangeOver(
      '<p><span style="font-weight: 700">30</span> And Philip ran thither to ' +
        '<i style="font-style: italic">him</i> , and heard</p>',
    );
    expect(getRenderedRunsFromRange(range)).toEqual([
      { text: '30', bold: true, italic: false },
      { text: ' And Philip ran thither to ', bold: false, italic: false },
      { text: 'him', bold: false, italic: true },
      { text: ' , and heard', bold: false, italic: false },
    ]);
  });
});
