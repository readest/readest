// @vitest-environment jsdom
// jsdom, not happy-dom: happy-dom can't parse the `*|type` selector that finds
// a namespaced `epub:type` in an XHTML section.
import { describe, it, expect } from 'vitest';
import { linksToDeclaredNote } from '@/app/reader/utils/footnoteHeuristics';

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html').body;

const getAnchorByText = (root: Element, text: string) => {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    if ((a.textContent || '').trim() === text) return a as HTMLAnchorElement;
  }
  throw new Error(`anchor with text "${text}" not found`);
};

// The chapter from #7982: three note markers, then a cross-reference in the
// same paragraph to note 47, whose own marker sits in the next paragraph.
const chapter = (
  crossRef: string,
  marker = '<a href="ch1.xhtml#note-47" epub:type="noteref">47</a>',
) =>
  new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
      <p>
        one（<a href="ch1.xhtml#note-1" epub:type="noteref">1</a>）
        two（<a href="ch1.xhtml#note-2" epub:type="noteref">2</a>）
        three（<a href="ch1.xhtml#note-3" epub:type="noteref">3</a>）
        〔${crossRef}参照〕
      </p>
      <p>next<span id="ref-47">（${marker}）</span></p>
      <p id="note-47"><a href="ch1.xhtml#ref-47" role="doc-backlink">47</a> note 47</p>
    </body></html>`,
    'application/xhtml+xml',
  ).body;

describe('linksToDeclaredNote', () => {
  it('matches a cross-reference to a note a marker declares', () => {
    const body = chapter('<a href="ch1.xhtml#note-47">原注<span>47</span></a>');
    expect(linksToDeclaredNote(getAnchorByText(body, '原注47'))).toBe(true);
  });

  it('matches a marker declared by role or by an HTML epub:type attribute', () => {
    for (const marker of [
      '<a href="ch1.xhtml#note-47" role="doc-noteref">47</a>',
      '<a href="ch1.xhtml#note-47" epub:type="noteref">47</a>',
    ]) {
      const body = parseHtml(
        `<p>see <a href="ch1.xhtml#note-47">原注47</a></p><p>text${marker}</p>`,
      );
      expect(linksToDeclaredNote(getAnchorByText(body, '原注47'))).toBe(true);
    }
  });

  it('rejects a link whose target no marker declares as a note', () => {
    for (const marker of [
      '<a href="ch1.xhtml#note-47">47</a>',
      '<a href="ch1.xhtml#note-48" epub:type="noteref">48</a>',
      '<a href="ch1.xhtml#note-47" role="doc-backlink">47</a>',
    ]) {
      const body = chapter('<a href="ch1.xhtml#note-47">原注47</a>', marker);
      expect(linksToDeclaredNote(getAnchorByText(body, '原注47'))).toBe(false);
    }
  });

  it('rejects a link to a whole chapter', () => {
    const body = parseHtml(
      '<p><a href="ch2.xhtml">Chapter 2</a> and a marker<a href="ch2.xhtml" epub:type="noteref">1</a></p>',
    );
    expect(linksToDeclaredNote(getAnchorByText(body, 'Chapter 2'))).toBe(false);
  });
});
