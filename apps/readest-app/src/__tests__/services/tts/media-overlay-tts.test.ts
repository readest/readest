import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayTTS } from '@/services/tts/mediaOverlay/MediaOverlayTTS';
import { parseSSMLMarks } from '@/utils/ssml';

const par = (id: string, begin: number, end: number) =>
  `<par><text src="ch1.xhtml#${id}"/><audio src="ch1.mp3" clipBegin="${begin}s" clipEnd="${end}s"/></par>`;

// Two blocks: the first paragraph is narrated word-by-word (three pars sharing
// a block), the second as a whole (one par).
const HTML =
  '<p id="p1"><span id="w1">Alpha</span> <span id="w2">beta</span> <span id="w3">gamma</span></p>' +
  '<p id="p2">Second paragraph entirely.</p>';
const SMIL =
  '<smil xmlns="http://www.w3.org/ns/SMIL"><body>' +
  par('w1', 0, 1) +
  par('w2', 1, 2) +
  par('w3', 2, 3) +
  par('p2', 3, 6) +
  '</body></smil>';

const marksOf = (ssml: string | undefined) =>
  ssml === undefined ? undefined : parseSSMLMarks(ssml).marks.map((m) => m.name);

let section: MediaOverlaySection;
let doc: Document;
let highlight: ReturnType<typeof vi.fn<(range: Range) => void>>;

const makeTTS = () => new MediaOverlayTTS(doc, section, highlight);

beforeEach(async () => {
  doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html lang="en"><body>${HTML}</body></html>`,
    'text/html',
  );
  const book = {
    sections: [{ mediaOverlay: { href: 'OEBPS/ch1.smil', id: 'smil1' } }],
    loadText: async () => SMIL,
  } as unknown as BookDoc;
  section = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  highlight = vi.fn<(range: Range) => void>();
});

describe('MediaOverlayTTS', () => {
  test('exposes the section document, as the controller expects of a TTS', () => {
    expect(makeTTS().doc).toBe(doc);
  });

  test('start() yields the first block from its first mark', () => {
    expect(marksOf(makeTTS().start())).toEqual(['0', '1', '2']);
  });

  test('resume() on a fresh instance yields the first block', () => {
    expect(marksOf(makeTTS().resume())).toEqual(['0', '1', '2']);
  });

  test('resume() re-yields the current block truncated at the last spoken mark', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('1');
    expect(marksOf(tts.resume())).toEqual(['1', '2']);
  });

  test('next() advances a whole block and resets the mark', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('1');
    expect(marksOf(tts.next())).toEqual(['3']);
    expect(marksOf(tts.resume())).toEqual(['3']);
  });

  test('next() past the last block yields nothing, so the controller changes section', () => {
    const tts = makeTTS();
    tts.start();
    tts.next();
    expect(tts.next()).toBeUndefined();
  });

  test('prev() moves back a block and yields it whole', () => {
    const tts = makeTTS();
    tts.start();
    tts.next();
    expect(marksOf(tts.prev())).toEqual(['0', '1', '2']);
  });

  test('prev() before the first block yields nothing', () => {
    const tts = makeTTS();
    tts.start();
    expect(tts.prev()).toBeUndefined();
  });

  test('nextMark() steps one par inside the block', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('0');
    expect(marksOf(tts.nextMark())).toEqual(['1', '2']);
  });

  test('nextMark() spills into the following block at the block end', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('2');
    expect(marksOf(tts.nextMark())).toEqual(['3']);
  });

  test('prevMark() steps back one par inside the block', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('2');
    expect(marksOf(tts.prevMark())).toEqual(['1', '2']);
  });

  test('prevMark() spills back into the previous block at its last par', () => {
    const tts = makeTTS();
    tts.start();
    tts.next();
    tts.setMark('3');
    expect(marksOf(tts.prevMark())).toEqual(['2']);
  });

  test('setMark() highlights the par range and returns it', () => {
    const tts = makeTTS();
    tts.start();
    const range = tts.setMark('1');
    expect(range?.toString()).toBe('beta');
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(highlight.mock.calls[0]![0].toString()).toBe('beta');
  });

  test('setMark() with an unknown name changes nothing', () => {
    const tts = makeTTS();
    tts.start();
    expect(tts.setMark('99')).toBeUndefined();
    expect(highlight).not.toHaveBeenCalled();
  });

  test('getLastRange() tracks the last spoken mark', () => {
    const tts = makeTTS();
    tts.start();
    expect(tts.getLastRange()).toBeUndefined();
    tts.setMark('2');
    expect(tts.getLastRange()?.toString()).toBe('gamma');
  });

  test('navigating while paused highlights without waiting for playback', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('0');
    highlight.mockClear();

    tts.nextMark(true);
    expect(highlight.mock.calls.at(-1)![0].toString()).toBe('beta');

    tts.next(true);
    expect(highlight.mock.calls.at(-1)![0].toString()).toBe('Second paragraph entirely.');
  });

  test('navigating while playing leaves highlighting to the audio boundaries', () => {
    const tts = makeTTS();
    tts.start();
    tts.setMark('0');
    highlight.mockClear();

    tts.nextMark();
    tts.next();
    expect(highlight).not.toHaveBeenCalled();
  });

  test('from(range) resumes at the par containing the range', () => {
    const tts = makeTTS();
    const target = doc.createRange();
    const gamma = doc.getElementById('w3')!;
    target.selectNodeContents(gamma);

    expect(marksOf(tts.from(target))).toEqual(['2']);
    expect(tts.getLastRange()?.toString()).toBe('gamma');
  });

  test('from(range) picks the par a mid-sentence range falls inside', () => {
    const tts = makeTTS();
    const target = doc.createRange();
    const text = doc.getElementById('p2')!.firstChild!;
    target.setStart(text, 7);
    target.setEnd(text, 16);

    expect(marksOf(tts.from(target))).toEqual(['3']);
  });

  // Found by end-to-end playback: narration skips unnarrated sections, so the
  // location playback was requested from usually belongs to a DIFFERENT
  // section's document. compareBoundaryPoints throws WrongDocumentError across
  // documents, which aborted the whole session before any audio played.
  test('from(range) tolerates a range from another section document', () => {
    const other = new DOMParser().parseFromString(
      '<!DOCTYPE html><html><body><p id="elsewhere">Front matter.</p></body></html>',
      'text/html',
    );
    const foreign = other.createRange();
    foreign.selectNodeContents(other.getElementById('elsewhere')!);

    const tts = makeTTS();
    expect(() => tts.from(foreign)).not.toThrow();
    expect(marksOf(tts.from(foreign))).toEqual(['0', '1', '2']);
  });

  test('from(range) before any par falls back to the first block', () => {
    const tts = makeTTS();
    const target = doc.createRange();
    target.setStart(doc.body, 0);
    target.setEnd(doc.body, 0);

    expect(marksOf(tts.from(target))).toEqual(['0', '1', '2']);
  });
});
