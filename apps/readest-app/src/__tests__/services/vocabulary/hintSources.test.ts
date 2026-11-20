// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstSense, hintFromDictionary } from '@/services/vocabulary/hintSources';
import { wiktionaryProvider } from '@/services/dictionaries/providers/wiktionaryProvider';
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
    expect(firstSense('[数学] 区间 [0, 1]。', 'interval')).toBe('[数学] 区间 [0, 1]。');
    expect(firstSense('[数学] 0, 1。', 'interval')).toBe('[数学] 0, 1。');
  });

  it('skips a line of two pronunciations', () => {
    expect(firstSense('happy\n/ˈhæpi/ /ˈhæpi/\nadj. feeling pleasure', 'happy')).toBe(
      'feeling pleasure',
    );
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
      // Plain-text entries render in a <pre>, as the StarDict/DICT/slob providers do.
      const pre = document.createElement('pre');
      pre.textContent = text;
      ctx.container.append(pre);
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

  it('takes the first list item of other dictionaries, even before an ordered example', async () => {
    const hint = await hintFromDictionary('luck', 'en', [
      htmlProvider('<ul><li>good fortune<ol><li>She had good luck.</li></ol></li></ul>'),
    ]);
    expect(hint).toBe('good fortune');
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

// Pages shaped like the live entries in #7707, through the real Wiktionary provider.
describe('hintFromDictionary from Wiktionary', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => body }) as Response),
    );
  const nativePage = (title: string, html: string) =>
    respond({ parse: { title, text: `<div class="mw-parser-output">${html}</div>` } });
  const heading = (level: number, text: string) =>
    `<div class="mw-heading mw-heading${level}"><h${level}>${text}</h${level}></div>`;

  it('takes the English sense, not the Translingual code listed first', async () => {
    respond({
      en: [
        {
          partOfSpeech: 'Symbol',
          language: 'Translingual',
          definitions: [{ definition: 'ISO 639-2 &amp; ISO 639-3 language code for Kirundi.' }],
        },
        {
          partOfSpeech: 'Verb',
          language: 'English',
          definitions: [
            { definition: 'To move swiftly.', examples: ['Run, and you might catch it!'] },
          ],
        },
      ],
    });
    expect(await hintFromDictionary('run', 'en', [wiktionaryProvider])).toBe('To move swiftly');
  });

  it("takes German Wiktionary's first numbered meaning", async () => {
    nativePage(
      'Glück',
      heading(2, 'Glück (Deutsch)') +
        heading(3, 'Substantiv, n') +
        '<p>Worttrennung:</p><dl><dd>Glück, kein Plural</dd></dl>' +
        '<p>Bedeutungen:</p><ul><li>Plural selten:</li></ul>' +
        '<dl><dd>[1] sich positiv auswirkender Zufall</dd><dd>[2] Fortuna</dd></dl>',
    );
    expect(await hintFromDictionary('Glück', 'de', [wiktionaryProvider])).toBe(
      'sich positiv auswirkender Zufall',
    );
  });

  it("takes Spanish Wiktionary's numbered meaning, not its notes", async () => {
    nativePage(
      'suerte',
      heading(2, 'Español') +
        heading(3, 'Etimología 1') +
        '<p>Del latín <i>sors</i>.</p>' +
        heading(4, 'Sustantivo femenino') +
        '<dl><dt>1</dt><dd>Causa supuesta de una consecución de sucesos no previsibles.' +
        '<ul><li>Sinónimos: fortuna, hado, destino.</li></ul></dd></dl>',
    );
    expect(await hintFromDictionary('suerte', 'es', [wiktionaryProvider])).toBe(
      'Causa supuesta de una consecución de',
    );
  });

  it("takes Japanese Wiktionary's ordered meaning, not the accent notes before it", async () => {
    nativePage(
      '猫',
      heading(2, '日本語') +
        '<p>アクセント</p><ul><li>(東京式) ねこ [néꜜkò] (頭高型 – [1])</li></ul>' +
        heading(3, '名詞') +
        '<ol><li>ネコ科を構成する小型の哺乳類。</li></ol>',
    );
    expect(await hintFromDictionary('猫', 'ja', [wiktionaryProvider])).toBe(
      'ネコ科を構成する小型の哺乳類。',
    );
  });
});
