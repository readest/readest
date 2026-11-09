// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { shouldCheckAsFootnote } from '@/app/reader/utils/footnoteHeuristics';

const parseHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body;
};

const getAnchorByText = (root: Element, text: string) => {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    if ((a.textContent || '').trim() === text) return a as HTMLAnchorElement;
  }
  throw new Error(`anchor with text "${text}" not found`);
};

describe('shouldCheckAsFootnote', () => {
  it('returns false for non-numeric link text', () => {
    const body = parseHtml('<p>Body text<a href="#x">go here</a> more text</p>');
    const a = getAnchorByText(body, 'go here');
    expect(shouldCheckAsFootnote(a)).toBe(false);
  });

  it('returns true for an isolated short-numeric link in body text', () => {
    const body = parseHtml(
      '<p>The quick brown fox<a href="#n1">1</a> jumps over the lazy dog.</p>',
    );
    const a = getAnchorByText(body, '1');
    expect(shouldCheckAsFootnote(a)).toBe(true);
  });

  it('returns false when the link is part of an inline verse-number list (OSB v2 layout)', () => {
    // Mirrors the in-book "Verses in Chapter 32" TOC layout: a flat list of
    // numeric verse links wrapped in nested spans, separated by commas.
    const body = parseHtml(`
      <p class="calibre34"><span class="calibre6">
        <span><a href="../split_067.html#filepos416575">1</a></span>,
        <span><a href="../split_067.html#filepos416915">2</a></span>,
        <span><a href="../split_067.html#filepos417015">3</a></span>,
        <span><a href="../split_067.html#filepos417238">4</a></span>,
        <span><a href="../split_067.html#filepos417377">5</a></span>
      </span></p>
    `);
    const a = getAnchorByText(body, '1');
    expect(shouldCheckAsFootnote(a)).toBe(false);
  });

  it('returns false when the link is part of a pipe-separated chapter list (OSB v4 layout)', () => {
    // Mirrors the in-book chapter index: <a>1</a> | <a>2</a> | ... | <a>34</a>
    const body = parseHtml(`
      <p>
        <a href="part0030.xhtml">1</a> |
        <a href="part0030.xhtml#a2D14">2</a> |
        <a href="part0030.xhtml#a2D15">3</a> |
        <a href="part0030.xhtml#a1W36">4</a> |
        <a href="part0030.xhtml#a2CPZ">32</a>
      </p>
    `);
    const a = getAnchorByText(body, '32');
    expect(shouldCheckAsFootnote(a)).toBe(false);
  });

  it('still recognises a real footnote marker even when one other footnote sits in the same paragraph', () => {
    // A single body paragraph with two footnote markers is plausible; only
    // 2+ *additional* numeric siblings should disqualify.
    const body = parseHtml(
      '<p>First reference<a href="#n1">1</a> and a second sentence<a href="#n2">2</a> finishes.</p>',
    );
    const a = getAnchorByText(body, '1');
    expect(shouldCheckAsFootnote(a)).toBe(true);
  });

  it('returns false when 2+ sibling numeric links share the container', () => {
    const body = parseHtml('<p>Refs: <a href="#a">1</a> <a href="#b">2</a> <a href="#c">3</a></p>');
    const a = getAnchorByText(body, '1');
    expect(shouldCheckAsFootnote(a)).toBe(false);
  });

  it('recognises bracketed and half-bracketed footnote markers', () => {
    for (const marker of ['[1]', '(1)', '【1】', '［1］', '（1）', '25）', '〔1〕', '〈1〉']) {
      const body = parseHtml(`<p>Sample text<a href="#fn">${marker}</a> following text.</p>`);
      const a = getAnchorByText(body, marker);
      expect(shouldCheckAsFootnote(a)).toBe(true);
    }
  });

  it('recognises prefixed footnote markers', () => {
    for (const marker of [
      '（注1）',
      '注1',
      '訳注1',
      '原注2',
      '編注3',
      '注釈1',
      'Note 1',
      'Notes 2',
      'fn1',
    ]) {
      const body = parseHtml(`<p>Sample text<a href="#fn">${marker}</a> following text.</p>`);
      const a = getAnchorByText(body, marker);
      expect(shouldCheckAsFootnote(a)).toBe(true);
    }
  });

  it('recognises footnote ranges', () => {
    for (const marker of ['61～69）', '72～77）', '1-5', '（1〜3）']) {
      const body = parseHtml(`<p>Sample text<a href="#fn">${marker}</a> following text.</p>`);
      const a = getAnchorByText(body, marker);
      expect(shouldCheckAsFootnote(a)).toBe(true);
    }
  });

  it('recognises full-width numeric digits and circled numbers', () => {
    for (const marker of ['１', '２', '①', '②', '⑳']) {
      const body = parseHtml(`<p>Sample text<a href="#fn">${marker}</a> following text.</p>`);
      const a = getAnchorByText(body, marker);
      expect(shouldCheckAsFootnote(a)).toBe(true);
    }
  });

  it('recognises footnote symbols', () => {
    for (const marker of ['＊', '*', '※', '†', '‡']) {
      const body = parseHtml(`<p>Sample text<a href="#fn">${marker}</a> following text.</p>`);
      const a = getAnchorByText(body, marker);
      expect(shouldCheckAsFootnote(a)).toBe(true);
    }
  });

  it('returns false for navigation links, headings, or back-links containing numbers', () => {
    for (const text of [
      '1.1 Note on Terminology',
      'Chapter 1',
      'Section 2',
      '（本文へ戻る）',
      'Back to top',
    ]) {
      const body = parseHtml(`<p>Content <a href="#target">${text}</a> more text.</p>`);
      const a = getAnchorByText(body, text);
      expect(shouldCheckAsFootnote(a)).toBe(false);
    }
  });
});
