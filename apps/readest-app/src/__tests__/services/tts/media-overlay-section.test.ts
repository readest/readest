import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import { loadMediaOverlaySection } from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { parseSSMLMarks } from '@/utils/ssml';
import * as CFI from 'foliate-js/epubcfi.js';

const SMIL_HREF = 'OEBPS/ch1.smil';

const smil = (body: string) =>
  `<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body>${body}</body></smil>`;

const par = (id: string, begin: number, end: number, audio = 'ch1.mp3') =>
  `<par><text src="ch1.xhtml#${id}"/><audio src="${audio}" clipBegin="${begin}s" clipEnd="${end}s"/></par>`;

const makeDoc = (html: string): Document =>
  new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>${html}</body></html>`,
    'text/html',
  );

const makeBook = (smilXml: string | null, overlay = { href: SMIL_HREF, id: 'smil1' }): BookDoc =>
  ({
    sections: [{ mediaOverlay: smilXml === null ? null : overlay }],
    loadText: vi.fn(async () => smilXml),
  }) as unknown as BookDoc;

// Sentence-per-par: each narrated element is its own <p>, so every par is its
// own block. The common shape for adult read-along titles.
const SENTENCE_LEVEL = {
  html: '<p id="s1">First sentence here.</p><p id="s2">Second sentence here.</p>',
  smil: smil(par('s1', 0, 3.5) + par('s2', 3.5, 7.25)),
};

// Word-per-par inside one paragraph: all pars share a block, which is what
// gives word-by-word highlighting for free.
const WORD_LEVEL = {
  html: '<p id="p1"><span id="w1">Alpha</span> <span id="w2">beta</span> <span id="w3">gamma</span></p>',
  smil: smil(par('w1', 0, 0.5) + par('w2', 0.5, 1.25) + par('w3', 1.25, 2)),
};

describe('loadMediaOverlaySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns null when the section carries no media overlay', async () => {
    const section = await loadMediaOverlaySection(makeBook(null), 0, makeDoc('<p>x</p>'), 'en');
    expect(section).toBeNull();
  });

  test('returns null when the SMIL resolves to no usable pars', async () => {
    const section = await loadMediaOverlaySection(
      makeBook(smil(par('missing-id', 0, 1))),
      0,
      makeDoc(SENTENCE_LEVEL.html),
      'en',
    );
    expect(section).toBeNull();
  });

  test('loads the SMIL by the manifest href of the overlay', async () => {
    const book = makeBook(SENTENCE_LEVEL.smil);
    await loadMediaOverlaySection(book, 0, makeDoc(SENTENCE_LEVEL.html), 'en');
    expect(book.loadText).toHaveBeenCalledWith(SMIL_HREF);
  });

  test('resolves each par to a range over its element and numbers marks section-globally', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(SENTENCE_LEVEL.smil),
      0,
      makeDoc(SENTENCE_LEVEL.html),
      'en',
    ))!;

    expect(section.pars.map((p) => p.markName)).toEqual(['0', '1']);
    expect(section.pars.map((p) => p.range.toString())).toEqual([
      'First sentence here.',
      'Second sentence here.',
    ]);
    expect(section.pars.map((p) => p.clipEnd)).toEqual([3.5, 7.25]);
  });

  test('gives each narrated block its own entry when pars are whole paragraphs', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(SENTENCE_LEVEL.smil),
      0,
      makeDoc(SENTENCE_LEVEL.html),
      'en',
    ))!;

    expect(section.blockCount).toBe(2);
    expect(section.blocks.map((block) => block.map((p) => p.markName))).toEqual([['0'], ['1']]);
  });

  test('groups word-level pars sharing a paragraph into one block', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(WORD_LEVEL.smil),
      0,
      makeDoc(WORD_LEVEL.html),
      'en',
    ))!;

    expect(section.blockCount).toBe(1);
    expect(section.blocks[0]!.map((p) => p.markName)).toEqual(['0', '1', '2']);
    expect(section.pars.every((p) => p.blockIndex === 0)).toBe(true);
  });

  test('drops pars whose element is absent from the document but keeps the rest', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('s1', 0, 1) + par('gone', 1, 2) + par('s2', 2, 3))),
      0,
      makeDoc(SENTENCE_LEVEL.html),
      'en',
    ))!;

    expect(section.pars.map((p) => p.range.toString())).toEqual([
      'First sentence here.',
      'Second sentence here.',
    ]);
    expect(section.pars.map((p) => p.markName)).toEqual(['0', '1']);
  });

  // Found by end-to-end playback: a range built with selectNodeContents() has
  // both boundaries on the ELEMENT, and foliate's getCFI then emits a range CFI
  // whose start and end paths are identical. The TTS highlighter round-trips
  // every range through a CFI before drawing, so such a range re-anchored to
  // nothing and the highlight never painted.
  test('anchors ranges inside text nodes so a CFI round-trip survives', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(SENTENCE_LEVEL.smil),
      0,
      makeDoc(SENTENCE_LEVEL.html),
      'en',
    ))!;

    for (const par of section.pars) {
      expect(par.range.startContainer.nodeType).toBe(Node.TEXT_NODE);
      expect(par.range.endContainer.nodeType).toBe(Node.TEXT_NODE);
      expect(par.range.collapsed).toBe(false);
    }
  });

  test('excludes whitespace around the narrated text', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('s1', 0, 1))),
      0,
      makeDoc('<p id="s1">\n      Padded sentence.\n   </p>'),
      'en',
    ))!;

    expect(section.pars[0]!.range.toString()).toBe('Padded sentence.');
    expect(section.pars[0]!.range.startOffset).toBeGreaterThan(0);
  });

  test('spans from the first to the last text node of a nested element', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('s1', 0, 1))),
      0,
      makeDoc('<p id="s1">Start <em>middle</em> end.</p>'),
      'en',
    ))!;

    const range = section.pars[0]!.range;
    expect(range.toString()).toBe('Start middle end.');
    expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(range.endContainer.nodeType).toBe(Node.TEXT_NODE);
    expect((range.endContainer as Text).data).toContain('end.');
  });

  test('drops pars whose element has neither text nor an image', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('empty', 0, 1) + par('s1', 1, 2))),
      0,
      makeDoc(`<p id="empty"> </p>${SENTENCE_LEVEL.html}`),
      'en',
    ))!;

    expect(section.pars.map((p) => p.range.toString())).toEqual(['First sentence here.']);
  });

  // #7342: a title page drawn as a picture, or a map whose alt text the narrator
  // reads, used to be dropped, so its clip was never heard.
  test.each([
    ['an img inside the target', '<span id="t"><img src="t.jpg" alt="Title. Author."/></span>'],
    ['the target is the img', '<img id="t" src="t.jpg" alt="Title. Author."/>'],
    ['an img with empty alt', '<span id="t"><img src="t.jpg" alt=""/></span>'],
    ['an svg figure', '<figure id="t"><svg><image href="map.jpg"/></svg></figure>'],
  ])('keeps the clip of an image-only par: %s', async (_shape, html) => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('t', 13.192, 22.036) + par('s1', 22.036, 25))),
      0,
      makeDoc(`${html}${SENTENCE_LEVEL.html}`),
      'en',
    ))!;

    expect(section.pars.map((p) => [p.clipBegin, p.clipEnd])).toEqual([
      [13.192, 22.036],
      [22.036, 25],
    ]);
    const image = section.pars[0]!;
    const doc = image.range.startContainer.ownerDocument!;
    expect(image.range.collapsed).toBe(false);
    expect(image.range.intersectsNode(doc.querySelector('img, svg')!)).toBe(true);
    // Each mark keeps its own text run, so the controller steps onto the next par.
    const { marks } = parseSSMLMarks(section.ssmlForBlock(0)!);
    expect(marks.map((m) => m.name)).toEqual(['0']);
    expect(section.blockCount).toBe(2);
  });

  test("carries an image's description as the par's text", async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('t', 0, 9))),
      0,
      makeDoc('<span id="t"><img src="t.jpg" alt="Tomorrow. Gabrielle Zevin."/></span>'),
      'en',
    ))!;

    expect(section.pars[0]!.text).toBe('Tomorrow. Gabrielle Zevin.');
  });

  // The highlighter re-anchors every range through a CFI before painting, and
  // the overlayer paints the images the anchored range intersects.
  test.each([
    ['a span around the img', 'Intro. <span id="t"><img src="t.jpg" alt="x"/></span> After.'],
    [
      'a figure with whitespace',
      'Intro.<figure id="t">\n<img src="t.jpg" alt="x"/>\n</figure>After.',
    ],
    // Readest appends a cfi-inert skip link inside a section's last element,
    // which on a title page drawn as a picture is the narrated span itself.
    [
      'a span ending in the skip link',
      'Intro. <span id="t"><img src="t.jpg" alt="x"/><span cfi-inert="" aria-label="Skip"></span></span>',
    ],
  ])('re-anchors an image par over the image alone: %s', async (_shape, html) => {
    const doc = makeDoc(`<div>${html}</div>`);
    const section = (await loadMediaOverlaySection(makeBook(smil(par('t', 0, 9))), 0, doc, 'en'))!;

    const anchored = CFI.toRange(doc, CFI.parse(CFI.fromRange(section.pars[0]!.range))) as Range;
    expect(anchored.intersectsNode(doc.querySelector('img')!)).toBe(true);
    expect(anchored.toString().trim()).toBe('');
  });

  test('never re-anchors a bare img target over the text around it', async () => {
    const doc = makeDoc('<p>Intro <img id="t" src="t.jpg" alt="x"/> after.</p>');
    const section = (await loadMediaOverlaySection(makeBook(smil(par('t', 0, 9))), 0, doc, 'en'))!;

    const anchored = CFI.toRange(doc, CFI.parse(CFI.fromRange(section.pars[0]!.range))) as Range;
    expect(anchored.toString()).toBe('');
  });

  test('builds SSML whose marks round-trip through parseSSMLMarks', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(WORD_LEVEL.smil),
      0,
      makeDoc(WORD_LEVEL.html),
      'en',
    ))!;

    const { marks } = parseSSMLMarks(section.ssmlForBlock(0)!);
    expect(marks.map((m) => m.name)).toEqual(['0', '1', '2']);
    expect(marks.map((m) => m.text)).toEqual(['Alpha', 'beta', 'gamma']);
  });

  test('truncates SSML to start at a given mark, as resuming mid-block does', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(WORD_LEVEL.smil),
      0,
      makeDoc(WORD_LEVEL.html),
      'en',
    ))!;

    const { marks } = parseSSMLMarks(section.ssmlForBlock(0, '1')!);
    expect(marks.map((m) => m.name)).toEqual(['1', '2']);
  });

  test('escapes text so markup in the book cannot break the SSML', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('s1', 0, 1))),
      0,
      makeDoc('<p id="s1">Tom &amp; Jerry &lt;fast&gt;</p>'),
      'en',
    ))!;

    const ssml = section.ssmlForBlock(0)!;
    expect(ssml).toContain('Tom &amp; Jerry &lt;fast&gt;');
    const { marks } = parseSSMLMarks(ssml);
    expect(marks).toHaveLength(1);
  });

  test('carries exact clip durations onto the timeline sentences', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(SENTENCE_LEVEL.smil),
      0,
      makeDoc(SENTENCE_LEVEL.html),
      'en',
    ))!;

    expect(section.timelineSentences().map((s) => s.duration)).toEqual([3.5, 3.75]);
    expect(section.timelineSentences().map((s) => s.blockIndex)).toEqual([0, 1]);
    expect(section.timelineSentences().map((s) => s.markName)).toEqual(['0', '1']);
  });

  test('returns the pars from a mark to the end of its block', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(WORD_LEVEL.smil),
      0,
      makeDoc(WORD_LEVEL.html),
      'en',
    ))!;

    expect(section.parsFrom('1').map((p) => p.markName)).toEqual(['1', '2']);
    expect(section.parByMark('2')?.clipBegin).toBe(1.25);
    expect(section.parByMark('9')).toBeUndefined();
  });

  test('survives a SMIL file that fails to load', async () => {
    const book = {
      sections: [{ mediaOverlay: { href: SMIL_HREF, id: 'smil1' } }],
      loadText: vi.fn(async () => {
        throw new Error('missing entry');
      }),
    } as unknown as BookDoc;

    await expect(loadMediaOverlaySection(book, 0, makeDoc('<p id="s1">x</p>'), 'en')).resolves.toBe(
      null,
    );
  });
});
