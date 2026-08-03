import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import { loadMediaOverlaySection } from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { parseSSMLMarks } from '@/utils/ssml';

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

  test('drops pars whose element has no readable text', async () => {
    const section = (await loadMediaOverlaySection(
      makeBook(smil(par('img', 0, 1) + par('s1', 1, 2))),
      0,
      makeDoc(`<p id="img"><img alt=""/></p>${SENTENCE_LEVEL.html}`),
      'en',
    ))!;

    expect(section.pars.map((p) => p.range.toString())).toEqual(['First sentence here.']);
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
