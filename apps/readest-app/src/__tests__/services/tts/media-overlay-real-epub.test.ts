// Integration coverage against a real EPUB 3 Media Overlays book, opened
// through the real DocumentLoader / foliate EPUB parser rather than a stub.
//
// The fixture is a ~10 MB binary, so it is not committed. Point the test at a
// local copy to run it:
//
//   curl -sLO https://github.com/IDPF/epub3-samples/releases/download/20230704/moby-dick-mo.epub
//   READEST_MO_EPUB=$PWD/moby-dick-mo.epub pnpm test -- media-overlay-real-epub
//
// Without it the suite soft-skips, the same way the koplugin Lua specs do when
// their toolchain is absent. Moby-Dick MO is the canonical W3C sample and a
// deliberately awkward one: chapter 1 mixes a heading par, three per-WORD pars,
// and seven per-sentence pars inside a single <p>, all under a nested <seq>
// carrying epub:textref and epub:type.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { DocumentLoader, type BookDoc } from '@/libs/document';
import { loadMediaOverlaySection } from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayTTS } from '@/services/tts/mediaOverlay/MediaOverlayTTS';
import { findNarratedSection, hasMediaOverlays } from '@/services/tts/mediaOverlay';
import { SectionTimeline } from '@/services/tts/SectionTimeline';
import { parseSSMLMarks } from '@/utils/ssml';

const FIXTURE =
  process.env['READEST_MO_EPUB'] ??
  path.resolve(__dirname, '../../fixtures/data/moby-dick-mo.epub');

const available = fs.existsSync(FIXTURE);
const describeIf = available ? describe : describe.skip;

if (!available) {
  console.warn(`[media-overlay] fixture not found, skipping: ${FIXTURE}`);
}

let book: BookDoc;

// Real spine layout: 0=cover, 1=titlepage, 2=brief-toc, 3=preface,
// 4=introduction, 5=epigraph, 6=chapter_001, 7=chapter_002, then 136 more
// chapters. Only the first two chapters carry a Media Overlay — the sample is a
// partial narration, which makes it an honest test of gap handling.
const CH1 = 6;
const CH2 = 7;

describeIf('real Media Overlays EPUB (Moby-Dick MO)', () => {
  beforeAll(async () => {
    const bytes = fs.readFileSync(FIXTURE);
    const file = new File([bytes], path.basename(FIXTURE), {
      type: 'application/epub+zip',
    });
    book = (await new DocumentLoader(file).open()).book;
  });

  test('foliate surfaces the narration data our types expect', () => {
    expect(hasMediaOverlays(book)).toBe(true);
    expect(book.media?.narrator).toBe('Stuart Wills');
    // media:duration for the whole publication, parsed from 0:23:23.500.
    expect(book.media?.duration).toBeCloseTo(1403.5, 3);
    expect(book.sections[CH1]!.mediaOverlay?.href).toBe('OPS/chapter_001_overlay.smil');
    expect(book.sections[CH2]!.mediaOverlay?.href).toBe('OPS/chapter_002_overlay.smil');
    expect(book.sections).toHaveLength(144);
  });

  test('unnarrated front matter is skipped, and a narration gap ends playback', () => {
    // Pressing play in the cover/titlepage/preface run jumps to chapter 1
    // rather than sitting in silence.
    expect(findNarratedSection(book, 0, 1)).toBe(CH1);
    expect(findNarratedSection(book, CH1, 1)).toBe(CH1);
    expect(findNarratedSection(book, CH2, 1)).toBe(CH2);
    // Nothing after chapter 2 is narrated, so auto-advance runs out of content
    // instead of silently playing 136 silent chapters.
    expect(findNarratedSection(book, CH2 + 1, 1)).toBe(-1);
    // Going backwards from deep in the book finds chapter 2.
    expect(findNarratedSection(book, 143, -1)).toBe(CH2);
    expect(findNarratedSection(book, CH1 - 1, -1)).toBe(-1);
  });

  test('pars resolve against the real section document, at the real clip times', async () => {
    const doc = await book.sections[CH1]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH1, doc, 'en-US'))!;
    expect(section).not.toBeNull();

    // The heading par, then the three per-word pars the sample opens with.
    expect(section.pars.slice(0, 4).map((p) => p.range.toString())).toEqual([
      'Chapter 1. Loomings.',
      'Call',
      'me',
      'Ishmael.',
    ]);
    expect(section.pars[1]!.clipBegin).toBeCloseTo(29.268, 3);
    expect(section.pars[1]!.clipEnd).toBeCloseTo(29.441, 3);
    // Word clips are ~0.2s; nothing but the recording's own timings could
    // produce that.
    expect(section.pars[1]!.clipEnd - section.pars[1]!.clipBegin).toBeLessThan(0.3);
    expect(section.pars.every((p) => p.audioHref.startsWith('OPS/audio/'))).toBe(true);
  });

  test('the heading is its own block; the words and sentences sharing a <p> are one', async () => {
    const doc = await book.sections[CH1]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH1, doc, 'en-US'))!;

    // Block 0: <h1>. Block 1: the ten spans inside the first <p> (3 words +
    // 7 sentences). This is what makes paragraph-skip land on paragraphs while
    // sentence-skip still steps word by word through the opening line.
    expect(section.blocks[0]!.map((p) => p.range.toString())).toEqual(['Chapter 1. Loomings.']);
    expect(section.blocks[1]).toHaveLength(10);
    expect(section.blocks[1]!.slice(0, 3).map((p) => p.range.toString())).toEqual([
      'Call',
      'me',
      'Ishmael.',
    ]);
    // Later blocks are whole paragraphs, one par each.
    expect(section.blocks[2]).toHaveLength(1);
    expect(section.blocks[2]![0]!.range.toString()).toContain('There now is your insular city');
  });

  test('a block of contiguous word clips is one continuous audio span', async () => {
    const doc = await book.sections[CH1]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH1, doc, 'en-US'))!;
    const block = section.blocks[1]!;

    // Every par in the block comes from the same file, back to back — so the
    // client plays [first.clipBegin, last.clipEnd] without a seam.
    expect(new Set(block.map((p) => p.audioHref)).size).toBe(1);
    for (let i = 1; i < block.length; i++) {
      expect(block[i]!.clipBegin).toBeCloseTo(block[i - 1]!.clipEnd, 3);
    }
  });

  test('the timeline reports the recording real duration, fully measured', async () => {
    const doc = await book.sections[CH1]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH1, doc, 'en-US'))!;
    const timeline = new SectionTimeline(section.timelineSentences(), 'en-US', 'media-overlay');

    expect(timeline.length).toBe(section.pars.length);
    expect(timeline.getMeasuredFraction()).toBeCloseTo(1, 6);
    // Narration of chapter 1 runs to media:duration 0:14:20.500 = 860.5s. The
    // pars cover from the heading's clipBegin to the last clipEnd, so the
    // timeline is that span minus the unnarrated lead-in.
    const covered = section.pars.at(-1)!.clipEnd - section.pars[0]!.clipBegin;
    expect(timeline.getDuration()).toBeLessThanOrEqual(860.5);
    expect(timeline.getDuration()).toBeGreaterThan(covered * 0.9);

    // Seeking maps back to the par containing that moment.
    const target = section.pars[5]!;
    const at = timeline.positionAt(5);
    expect(timeline.sentenceAtTime(at)!.index).toBe(5);
    expect(timeline.sentenceAtTime(at)!.sentence.text).toBe(target.text);
  });

  test('navigation over real pars: sentence-skip steps words, paragraph-skip jumps blocks', async () => {
    const doc = await book.sections[CH1]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH1, doc, 'en-US'))!;
    const highlighted: string[] = [];
    const tts = new MediaOverlayTTS(doc, section, (range) => highlighted.push(range.toString()));

    // Block 0 is the heading.
    const first = parseSSMLMarks(tts.start()!).marks;
    expect(first).toHaveLength(1);
    expect(first[0]!.text).toBe('Chapter 1. Loomings.');

    // Paragraph-skip into the word block yields all ten of its marks.
    expect(parseSSMLMarks(tts.next()!).marks).toHaveLength(10);

    // Sentence-skip walks the words one at a time.
    tts.setMark(section.blocks[1]![0]!.markName);
    expect(highlighted.at(-1)).toBe('Call');
    tts.nextMark(true);
    expect(highlighted.at(-1)).toBe('me');
    tts.nextMark(true);
    expect(highlighted.at(-1)).toBe('Ishmael.');
    tts.nextMark(true);
    expect(highlighted.at(-1)).toContain('Some years ago');

    // And back out to the heading.
    tts.prev(true);
    expect(highlighted.at(-1)).toBe('Chapter 1. Loomings.');
  });

  test('the second chapter indexes independently', async () => {
    const doc = await book.sections[CH2]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH2, doc, 'en-US'))!;

    expect(section.pars.length).toBeGreaterThan(0);
    expect(section.pars.every((p) => p.clipEnd > p.clipBegin)).toBe(true);
    expect(section.pars.every((p) => p.text.length > 0)).toBe(true);
  });

  test('the audio each par points at is really in the container', async () => {
    const doc = await book.sections[CH1]!.createDocument();
    const section = (await loadMediaOverlaySection(book, CH1, doc, 'en-US'))!;
    const href = section.pars[0]!.audioHref;

    const blob = await book.loadBlob!(href);
    expect(blob).toBeTruthy();
    expect(blob.size).toBeGreaterThan(1000);
  });
});
