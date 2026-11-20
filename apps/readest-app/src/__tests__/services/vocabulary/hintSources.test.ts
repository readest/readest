// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { firstSense, hintFromDictionary } from '@/services/vocabulary/hintSources';
import type { DictionaryProvider } from '@/services/dictionaries/types';

describe('firstSense', () => {
  it('skips the headword and pronunciation lines and drops the part of speech', () => {
    expect(
      firstSense(
        'serendipity\n/ˌserənˈdɪpəti/\nn. the occurrence of events by chance; luck',
        'serendipity',
      ),
    ).toBe('the occurrence of events by chance');
  });

  it('keeps a cross-language gloss whole up to the first sense break', () => {
    expect(
      firstSense('Serendipity [ˌserənˈdɪpəti]\nn. 意外发现，机缘巧合；运气', 'serendipity'),
    ).toBe('意外发现，机缘巧合');
  });

  it('strips sense numbers and bracketed labels', () => {
    expect(firstSense('1. (noun) good fortune.', 'luck')).toBe('good fortune');
  });

  it('caps a long sense at a word boundary', () => {
    const sense = firstSense(
      'the faculty of making fortunate discoveries of things you were not looking for',
      'x',
    );
    expect(sense.length).toBeLessThanOrEqual(40);
    expect(sense.endsWith(' ')).toBe(false);
    expect('the faculty of making fortunate discoveries'.startsWith(sense)).toBe(true);
  });

  it('skips a pronunciation line that ends in marks like a dash and stars', () => {
    expect(firstSense("originate\n[ә'ridʒineit] - ★★\nvt. 创始, 发明, 发起", 'originate')).toBe(
      '创始, 发明, 发起',
    );
  });

  it('keeps a sense that starts with a bracketed label', () => {
    expect(firstSense('[计] 发自', 'originate')).toBe('[计] 发自');
  });

  it('returns an empty string when only the headword is there', () => {
    expect(firstSense('serendipity', 'serendipity')).toBe('');
  });
});

describe('hintFromDictionary', () => {
  const provider = (id: string, text: string | null): DictionaryProvider => ({
    id,
    kind: 'stardict',
    label: id,
    lookup: async (_word, ctx) => {
      if (text === null) return { ok: false, reason: 'empty' };
      ctx.container.textContent = text;
      return { ok: true };
    },
  });

  it('uses the first dictionary that has the word', async () => {
    const hint = await hintFromDictionary('luck', 'en', [
      provider('a', null),
      provider('b', 'luck\nn. good fortune'),
      provider('c', 'luck\nn. chance'),
    ]);
    expect(hint).toBe('good fortune');
  });

  const htmlProvider = (html: string): DictionaryProvider => ({
    id: 'html',
    kind: 'stardict',
    label: 'html',
    lookup: async (_word, ctx) => {
      ctx.container.innerHTML = html;
      return { ok: true };
    },
  });

  it('takes the first definition item without its examples', async () => {
    const hint = await hintFromDictionary('serendipity', 'en', [
      htmlProvider(
        '<hgroup><h1>serendipity</h1><p>English</p></hgroup><h2>Noun</h2>' +
          '<ol><li>An unsought, unintended discovery<ul><li>A happy example.</li></ul></li></ol>',
      ),
    ]);
    expect(hint).toBe('An unsought, unintended discovery');
  });

  it('splits block elements into lines when there is no list', async () => {
    const hint = await hintFromDictionary('luck', 'en', [
      htmlProvider('<div>luck</div><div>n. good fortune</div>'),
    ]);
    expect(hint).toBe('good fortune');
  });

  // MDict renders the entry into a shadow root after its stylesheets (#7446).
  const shadowProvider = (html: string): DictionaryProvider => ({
    id: 'mdict',
    kind: 'mdict',
    label: 'mdict',
    lookup: async (word, ctx) => {
      const headword = document.createElement('h1');
      headword.textContent = word;
      ctx.container.appendChild(headword);
      const host = document.createElement('div');
      ctx.container.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = '\n    a:empty {\n      background-color: transparent;\n    }\n';
      shadow.appendChild(style);
      const body = document.createElement('div');
      body.innerHTML = html;
      shadow.appendChild(body);
      return { ok: true };
    },
  });

  it('skips the stylesheets an MDict entry renders before its text', async () => {
    const hint = await hintFromDictionary('originate', 'en', [
      shadowProvider(
        '<style>.pos { color: red; }</style><div>originate</div>' +
          '<div><span class="pos">vt.</span> 创始, 发明, 发起</div>',
      ),
    ]);
    expect(hint).toBe('创始, 发明, 发起');
  });

  it('skips a stylesheet inside the first definition item', async () => {
    const hint = await hintFromDictionary('luck', 'en', [
      shadowProvider('<ol><li><style>b { color: red; }</style>good fortune</li></ol>'),
    ]);
    expect(hint).toBe('good fortune');
  });

  // ECDICT's "简明英汉字典增强版 - CSS" MDict, as the reader renders it.
  const ECDICT_ORIGINATE = `
<div class="bdy" id="ecdict">
<div class="ctn" id="content">
<div class="hwd">originate</div>
<hr class="hrz">
<div class="git">
  <span class="ipa">[ә'ridʒineit]</span>
  <span class="hnt">-</span>
  <span class="col" title="Collins Stars">★★</span>
</div>
<div class="gdc">
  <div class="dcb">
    <span class="pos">vt.</span>
    <span class="dcn">创始, 发明, 发起</span>
  </div>
  <div class="dcb">
    <span class="pos">vi.</span>
    <span class="dcn">发源, 发生, 起航</span>
  </div>
</div>
</div>
</div>`;

  it('reads source line breaks in an HTML entry as spaces, as the page shows them', async () => {
    const hint = await hintFromDictionary('originate', 'en', [shadowProvider(ECDICT_ORIGINATE)]);
    expect(hint).toBe('创始, 发明, 发起');
  });

  it('keeps the line breaks of a plain-text entry', async () => {
    const hint = await hintFromDictionary('luck', 'en', [
      htmlProvider('<h1>luck</h1><pre>luck\n/lʌk/\nn. good fortune\n2. chance</pre>'),
    ]);
    expect(hint).toBe('good fortune');
  });

  it('returns an empty string when no dictionary has it', async () => {
    expect(await hintFromDictionary('luck', 'en', [provider('a', null)])).toBe('');
  });
});
