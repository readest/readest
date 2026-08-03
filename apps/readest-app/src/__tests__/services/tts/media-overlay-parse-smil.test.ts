import { describe, expect, test } from 'vitest';

import { parseSmil, parseSmilClock } from '@/services/tts/mediaOverlay/parseSmil';

const smil = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
     <body>${body}</body>
   </smil>`;

describe('parseSmilClock', () => {
  test.each([
    ['0:00:12.5', 12.5],
    ['1:02:03', 3723],
    ['02:30', 150],
    ['12.5s', 12.5],
    ['2.5min', 150],
    ['1h', 3600],
    ['100ms', 0.1],
    ['7', 7],
  ])('parses %s', (input, expected) => {
    expect(parseSmilClock(input)).toBeCloseTo(expected, 6);
  });

  test('returns undefined for missing or unparseable values', () => {
    expect(parseSmilClock(null)).toBeUndefined();
    expect(parseSmilClock('')).toBeUndefined();
    expect(parseSmilClock('abc')).toBeUndefined();
    expect(parseSmilClock('mm:ss')).toBeUndefined();
  });
});

describe('parseSmil', () => {
  test('parses a flat par list and resolves hrefs relative to the SMIL file', () => {
    const pars = parseSmil(
      smil(`
        <par id="p1">
          <text src="chapter1.xhtml#s1"/>
          <audio src="../audio/ch1.mp3" clipBegin="0:00:00.000" clipEnd="0:00:03.500"/>
        </par>
        <par id="p2">
          <text src="chapter1.xhtml#s2"/>
          <audio src="../audio/ch1.mp3" clipBegin="0:00:03.500" clipEnd="0:00:07.250"/>
        </par>`),
      'OEBPS/smil/ch1.smil',
    );

    expect(pars).toEqual([
      {
        textHref: 'OEBPS/smil/chapter1.xhtml',
        textId: 's1',
        audioHref: 'OEBPS/audio/ch1.mp3',
        clipBegin: 0,
        clipEnd: 3.5,
      },
      {
        textHref: 'OEBPS/smil/chapter1.xhtml',
        textId: 's2',
        audioHref: 'OEBPS/audio/ch1.mp3',
        clipBegin: 3.5,
        clipEnd: 7.25,
      },
    ]);
  });

  test('walks nested seq elements in document order', () => {
    const pars = parseSmil(
      smil(`
        <seq epub:textref="chapter1.xhtml#h1">
          <par><text src="chapter1.xhtml#a"/><audio src="ch1.mp3" clipBegin="0s" clipEnd="1s"/></par>
          <seq epub:textref="chapter1.xhtml#p1">
            <par><text src="chapter1.xhtml#b"/><audio src="ch1.mp3" clipBegin="1s" clipEnd="2s"/></par>
            <par><text src="chapter1.xhtml#c"/><audio src="ch1.mp3" clipBegin="2s" clipEnd="3s"/></par>
          </seq>
          <par><text src="chapter1.xhtml#d"/><audio src="ch1.mp3" clipBegin="3s" clipEnd="4s"/></par>
        </seq>`),
      'OEBPS/ch1.smil',
    );

    expect(pars.map((p) => p.textId)).toEqual(['a', 'b', 'c', 'd']);
    expect(pars.map((p) => p.clipBegin)).toEqual([0, 1, 2, 3]);
  });

  test('keeps pars spanning multiple audio files', () => {
    const pars = parseSmil(
      smil(`
        <par><text src="c.xhtml#a"/><audio src="one.mp3" clipBegin="10s" clipEnd="11s"/></par>
        <par><text src="c.xhtml#b"/><audio src="two.mp3" clipBegin="0s" clipEnd="4s"/></par>`),
      'OEBPS/ch1.smil',
    );

    expect(pars.map((p) => p.audioHref)).toEqual(['OEBPS/one.mp3', 'OEBPS/two.mp3']);
  });

  test('drops pars without a text src, an audio src, or a usable clip range', () => {
    const pars = parseSmil(
      smil(`
        <par><audio src="ch1.mp3" clipBegin="0s" clipEnd="1s"/></par>
        <par><text src="c.xhtml#no-audio"/></par>
        <par><text src="c.xhtml"/><audio src="ch1.mp3" clipBegin="1s" clipEnd="2s"/></par>
        <par><text src="c.xhtml#empty"/><audio src="ch1.mp3" clipBegin="3s" clipEnd="3s"/></par>
        <par><text src="c.xhtml#backwards"/><audio src="ch1.mp3" clipBegin="5s" clipEnd="4s"/></par>
        <par><text src="c.xhtml#ok"/><audio src="ch1.mp3" clipBegin="6s" clipEnd="7s"/></par>`),
      'OEBPS/ch1.smil',
    );

    expect(pars.map((p) => p.textId)).toEqual(['ok']);
  });

  test('defaults a missing clipBegin to the start of the audio file', () => {
    const pars = parseSmil(
      smil(`<par><text src="c.xhtml#a"/><audio src="ch1.mp3" clipEnd="4s"/></par>`),
      'OEBPS/ch1.smil',
    );

    expect(pars).toHaveLength(1);
    expect(pars[0]!.clipBegin).toBe(0);
    expect(pars[0]!.clipEnd).toBe(4);
  });

  test('parses a SMIL document that omits the namespace', () => {
    const pars = parseSmil(
      `<smil version="3.0"><body>
         <par><text src="c.xhtml#a"/><audio src="ch1.mp3" clipBegin="0s" clipEnd="1s"/></par>
       </body></smil>`,
      'OEBPS/ch1.smil',
    );

    expect(pars.map((p) => p.textId)).toEqual(['a']);
  });

  test('returns an empty list for malformed XML', () => {
    expect(parseSmil('<smil><body><par>', 'OEBPS/ch1.smil')).toEqual([]);
  });
});
