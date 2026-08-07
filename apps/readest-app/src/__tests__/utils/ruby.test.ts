import { describe, expect, it } from 'vitest';
import { isKanaReading, isMutedRubyNode } from '@/utils/ruby';

const parse = (html: string): Document =>
  new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');

/** Every text node of the body, in document order. */
const textNodes = (doc: Document): Text[] => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
};

/** The text that survives the ruby mute rule, i.e. what TTS would speak. */
const spokenText = (html: string): string =>
  textNodes(parse(html))
    .filter((n) => !isMutedRubyNode(n))
    .map((n) => n.data)
    .join('');

describe('isKanaReading', () => {
  it('accepts hiragana and katakana readings', () => {
    expect(isKanaReading('あまた')).toBe(true);
    expect(isKanaReading('ヒエログリフ')).toBe(true);
    expect(isKanaReading('コーヒー')).toBe(true);
    expect(isKanaReading('ヴィクトリア・アルベルト')).toBe(true);
  });

  it('rejects emphasis dot marks used as ruby', () => {
    expect(isKanaReading('・')).toBe(false);
    expect(isKanaReading('・・・')).toBe(false);
    expect(isKanaReading('﹅')).toBe(false);
    expect(isKanaReading('●')).toBe(false);
    expect(isKanaReading('、')).toBe(false);
  });

  it('rejects non-kana glosses', () => {
    expect(isKanaReading('')).toBe(false);
    expect(isKanaReading('   ')).toBe(false);
    expect(isKanaReading('hieroglyph')).toBe(false);
    expect(isKanaReading('shēng')).toBe(false);
    expect(isKanaReading('ㄕㄥ')).toBe(false);
    expect(isKanaReading('神聖')).toBe(false);
    expect(isKanaReading('かん字')).toBe(false);
  });
});

describe('isMutedRubyNode', () => {
  it('mutes the base and speaks the reading for group ruby', () => {
    expect(spokenText('<p><ruby>数多<rt>あまた</rt></ruby>の</p>')).toBe('あまたの');
  });

  it('handles an explicit <rb> base', () => {
    expect(spokenText('<p><ruby><rb>数多</rb><rt>あまた</rt></ruby>の</p>')).toBe('あまたの');
  });

  it('concatenates interleaved mono ruby pairs', () => {
    expect(spokenText('<p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby></p>')).toBe('かんじ');
  });

  it('keeps okurigana whose <rt> is empty', () => {
    // The empty <rt> pads the okurigana so it renders without a reading; the
    // base run it annotates is the pronunciation itself and must be spoken.
    expect(spokenText('<p><ruby>振<rt>ふ</rt>り<rt></rt>仮名<rt>がな</rt></ruby></p>')).toBe(
      'ふりがな',
    );
  });

  it('speaks the reading when the base is a gaiji image', () => {
    expect(
      spokenText('<p><ruby><rb><img class="gaiji" alt="喰"/></rb><rt>く</rt></ruby>い殺され</p>'),
    ).toBe('くい殺され');
  });

  it('drops <rp> fallback parentheses', () => {
    expect(spokenText('<p><ruby>数多<rp>(</rp><rt>あまた</rt><rp>)</rp></ruby></p>')).toBe(
      'あまた',
    );
  });

  it('keeps the base when the reading is an emphasis dot', () => {
    expect(spokenText('<p><ruby>本当<rt>・・</rt></ruby>に</p>')).toBe('本当に');
  });

  it('keeps the base when the reading is pinyin or a latin gloss', () => {
    expect(spokenText('<p><ruby>生<rt>shēng</rt></ruby></p>')).toBe('生');
    expect(spokenText('<p><ruby>神聖文字<rt>hieroglyph</rt></ruby></p>')).toBe('神聖文字');
  });

  it('keeps the base for injected WordLens glosses', () => {
    expect(
      spokenText(
        '<p><ruby class="wl-gloss" cfi-skip="">辞書<rt cfi-inert="">じしょ</rt></ruby></p>',
      ),
    ).toBe('辞書');
  });

  it('mutes a trailing <rtc> annotation layer', () => {
    expect(spokenText('<p><ruby>東京<rt>とうきょう</rt><rtc>Tokyo</rtc></ruby></p>')).toBe(
      'とうきょう',
    );
  });

  it('mutes a stray <rt> outside any <ruby>', () => {
    expect(spokenText('<p>a<rt>x</rt>b</p>')).toBe('ab');
  });

  it('leaves text with no ruby ancestor alone', () => {
    expect(spokenText('<p>吾輩は猫である</p>')).toBe('吾輩は猫である');
  });

  it('never mutes the <ruby> element itself so its children are visited', () => {
    const doc = parse('<p><ruby>数多<rt>あまた</rt></ruby></p>');
    expect(isMutedRubyNode(doc.querySelector('ruby')!)).toBe(false);
  });

  it('mutes an <rb> element node, not just its text', () => {
    const doc = parse('<p><ruby><rb>数多</rb><rt>あまた</rt></ruby></p>');
    expect(isMutedRubyNode(doc.querySelector('rb')!)).toBe(true);
  });
});
