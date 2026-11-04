import { describe, expect, it } from 'vitest';
import {
  ankiHintOf,
  ankiLangOf,
  ankiLangTag,
  ankiWordOf,
  cleanAnkiField,
} from '@/services/vocabulary/anki';

describe('cleanAnkiField', () => {
  it('splits block HTML into lines', () => {
    expect(
      cleanAnkiField(
        '<div style="font-size:1.6em">serendipity</div><div>A <b>serendipity</b> it was.</div>',
      ),
    ).toEqual(['serendipity', 'A serendipity it was.']);
  });

  it('drops sound tags and decodes entities', () => {
    expect(cleanAnkiField('caf&eacute;&nbsp;[sound:cafe.mp3]<br>x &amp; y')).toEqual([
      'café',
      'x & y',
    ]);
  });

  it('returns nothing for image-only fields', () => {
    expect(cleanAnkiField('<img src="a.jpg">')).toEqual([]);
  });
});

describe('ankiWordOf', () => {
  it('takes the cloze answer', () => {
    expect(ankiWordOf(['I felt {{c1::melancholy::sad}} today.'])).toBe('melancholy');
  });

  it('takes the first line of a Readest front', () => {
    expect(
      ankiWordOf([
        '<div style="font-size:1.6em">spice</div><div>The <b>spice</b> must flow.</div>',
      ]),
    ).toBe('spice');
  });

  it('rejects a sentence of more than 5 words', () => {
    expect(ankiWordOf(['the spice must flow on Arrakis'])).toBeNull();
  });

  it('rejects more than 40 chars', () => {
    expect(ankiWordOf(['a'.repeat(41)])).toBeNull();
  });

  it('rejects unspaced text over 12 chars', () => {
    expect(ankiWordOf(['今日はとても良い天気ですね'])).toBeNull();
  });

  it('accepts a short CJK word', () => {
    expect(ankiWordOf(['勉強'])).toBe('勉強');
  });

  it('rejects empty, image-only and sound-only', () => {
    expect(ankiWordOf([''])).toBeNull();
    expect(ankiWordOf(['<img src="a.jpg">'])).toBeNull();
    expect(ankiWordOf(['[sound:x.mp3]'])).toBeNull();
  });
});

describe('ankiHintOf', () => {
  it('takes the hint line above the book line', () => {
    expect(ankiHintOf(['x', 'a drug<br><small>Dune — Frank Herbert</small>'])).toBe('a drug');
  });

  it('cuts to 80 chars', () => {
    expect(ankiHintOf(['x', 'h'.repeat(100)])).toHaveLength(80);
  });

  it('is undefined with one field', () => {
    expect(ankiHintOf(['x'])).toBeUndefined();
  });
});

describe('language tag', () => {
  it('round-trips', () => {
    expect(ankiLangOf(`readest Dune ${ankiLangTag('fr')}`)).toBe('fr');
  });

  it('is undefined without one', () => {
    expect(ankiLangOf('readest Dune')).toBeUndefined();
  });
});
