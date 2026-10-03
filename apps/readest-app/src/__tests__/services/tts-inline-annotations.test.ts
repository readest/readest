import { describe, expect, it } from 'vitest';
import {
  stripInlineReadingAnnotations,
  stripInlineReadingAnnotationsFromSSML,
} from '@/services/tts/inlineAnnotations';

const spokenText = (ssml: string): string => {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml');
  return doc.documentElement.textContent ?? '';
};

describe('inline TTS reading annotations', () => {
  it.each([
    ['彼は憂鬱（ゆううつ）な気分だった。', '彼は憂鬱な気分だった。'],
    ['彼は憂鬱(ゆううつ)な気分だった。', '彼は憂鬱な気分だった。'],
    ['彼は憂鬱《ゆううつ》な気分だった。', '彼は憂鬱な気分だった。'],
    ['辭（辞）を引く。', '辭を引く。'],
  ])('removes a kana or Han reading after a Han base: %s', (source, expected) => {
    expect(stripInlineReadingAnnotations(source)).toBe(expected);
  });

  it.each([
    ['그것이 인생(人生)이다.', '그것이 인생이다.'],
    ['그것이 인생（人生）이다.', '그것이 인생이다.'],
    ['음악(音\uF914)을 듣는다.', '음악을 듣는다.'],
  ])('removes a Hanja gloss after a Hangul base: %s', (source, expected) => {
    expect(stripInlineReadingAnnotations(source)).toBe(expected);
  });

  it('removes an annotation even when SSML elements split it from its base', () => {
    const ssml =
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja">' +
      '<lang xml:lang="ja">彼は憂鬱</lang><mark name="0"/>（<lang xml:lang="ja">ゆううつ</lang>）' +
      'な気分だった。</speak>';

    expect(spokenText(stripInlineReadingAnnotationsFromSSML(ssml))).toBe('彼は憂鬱な気分だった。');
  });

  it('removes a Hanja gloss from Korean SSML', () => {
    const ssml =
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko">' +
      '<lang xml:lang="ko">그것이 인생</lang><mark name="0"/>(人生)이다.</speak>';

    expect(spokenText(stripInlineReadingAnnotationsFromSSML(ssml))).toBe('그것이 인생이다.');
  });

  it.each([
    'Chapter 1（第一章）',
    '憂鬱（melancholy）な気分だった。',
    '憂鬱（ゆう、うつ）な気分だった。',
    '憂鬱 （ゆううつ）な気分だった。',
    '彼は（ゆううつ）な気分だった。',
    '인생(じんせい)이다.',
    '인생(人生, 삶)이다.',
    '인생 (人生)이다.',
  ])('keeps text that does not match the conservative reading heuristic: %s', (source) => {
    expect(stripInlineReadingAnnotations(source)).toBe(source);
  });

  it('returns malformed SSML unchanged', () => {
    const malformed = '<speak>憂鬱（ゆううつ）';
    expect(stripInlineReadingAnnotationsFromSSML(malformed)).toBe(malformed);
  });
});
