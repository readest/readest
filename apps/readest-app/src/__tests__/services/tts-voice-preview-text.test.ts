import { describe, expect, it } from 'vitest';
import { getPagePreviewText, getSampleText } from '@/services/tts/voicePreviewText';

const pageRange = (html: string, startSelector: string, offset = 0) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const range = doc.createRange();
  const start = doc.querySelector(startSelector)!.firstChild!;
  range.setStart(start, offset);
  range.setEnd(doc.body, doc.body.childNodes.length);
  return range;
};

describe('getSampleText', () => {
  it('speaks the voice’s language, Traditional Chinese for Taiwan and Hong Kong', () => {
    expect(getSampleText('fr-CA')).toMatch(/^Bonjour/);
    expect(getSampleText('zh-CN')).toContain('这个声音');
    expect(getSampleText('zh-TW')).toContain('這個聲音');
    expect(getSampleText('zh-HK')).toContain('這個聲音');
    expect(getSampleText('nb-NO')).toBe(getSampleText('no'));
  });

  it('falls back to English for a language without a sample', () => {
    expect(getSampleText('iu-Cans-CA')).toBe(getSampleText('en'));
  });
});

describe('getPagePreviewText', () => {
  it('reads whole sentences from the start of the paragraph the page opens in', () => {
    const range = pageRange(
      '<p id="a">It was a bright cold day in April, and the clocks were striking thirteen. ' +
        'Winston Smith slipped quickly through the glass doors. Nobody saw him.</p>',
      '#a',
      40,
    );
    // ~5 s at the default 15 chars/s: the first two sentences, not the third.
    expect(getPagePreviewText(range, 'en')).toBe(
      'It was a bright cold day in April, and the clocks were striking thirteen. ' +
        'Winston Smith slipped quickly through the glass doors.',
    );
  });

  it('runs on into the next paragraphs until it has enough', () => {
    const range = pageRange(
      '<h2 id="h">Chapter One</h2><p>Short line. Another one here.</p>',
      '#h',
    );
    expect(getPagePreviewText(range, 'en')).toBe('Chapter One Short line. Another one here.');
  });

  it('cuts a sentence longer than a preview at a word boundary', () => {
    const long = `${'word '.repeat(120)}end.`;
    const text = getPagePreviewText(pageRange(`<p id="a">${long}</p>`, '#a'), 'en')!;
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.endsWith('word')).toBe(true);
  });

  it('is null for a page without text', () => {
    expect(getPagePreviewText(pageRange('<p id="a"> </p>', '#a'), 'en')).toBeNull();
    expect(getPagePreviewText(null, 'en')).toBeNull();
  });

  it('is null while a remount has left the section document without a root', () => {
    const range = pageRange('<p id="a">It was a bright cold day in April.</p>', '#a');
    const doc = range.startContainer.ownerDocument!;
    doc.documentElement.remove();
    expect(range.startContainer).toBe(doc);
    expect(getPagePreviewText(range, 'en')).toBeNull();
  });
});
