/**
 * Built-in Wiktionary provider.
 *
 * Looks up the headword in en.wiktionary.org's REST API. For CJK headwords
 * (lang code starts with `zh`/`zho`), falls back to {@link fetchChineseDefinition}
 * which scrapes Wiktionary's wikitext for pinyin + meanings.
 *
 * In-popup link interception: any `a[rel="mw:WikiLink"]` in a definition is
 * rewritten to call `ctx.onNavigate(title)` instead of navigating away. The
 * shell uses this to push onto the per-tab history.
 *
 * Extracted from the legacy `WiktionaryPopup.tsx`. The fetch + DOM-build
 * code is functionally identical; the only change is writing into
 * `ctx.container` instead of a global `<main>` element so the renderer can
 * coexist with other tabs in the same popup.
 */
import type { DictionaryProvider, DictionaryLookupOutcome } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';
import { fetchChineseDefinition } from '../chineseDict';
import { normalizedLangCode } from '@/utils/lang';
import { stubTranslation as _ } from '@/utils/misc';

type Definition = {
  definition: string;
  examples?: string[];
};

type Result = {
  partOfSpeech: string;
  definitions: Definition[];
  language: string;
};

const interceptDictLinks = (
  definitionHtml: string,
  onNavigate?: (word: string) => void,
): HTMLElement[] => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = definitionHtml;
  const links = wrapper.querySelectorAll<HTMLAnchorElement>('a[rel="mw:WikiLink"]');
  links.forEach((link) => {
    const title = link.getAttribute('title');
    if (!title) return;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      onNavigate?.(title);
    });
    link.className = 'not-eink:text-primary underline cursor-pointer';
  });
  return Array.from(wrapper.childNodes) as HTMLElement[];
};

const renderChinese = async (
  word: string,
  container: HTMLElement,
  signal: AbortSignal,
): Promise<DictionaryLookupOutcome> => {
  const entry = await fetchChineseDefinition(word);
  if (signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
  if (!entry) return { ok: false, reason: 'empty' };

  const hgroup = document.createElement('hgroup');
  const h1 = document.createElement('h1');
  h1.textContent = entry.word;
  h1.className = 'text-lg font-bold';
  hgroup.append(h1);

  if (entry.pinyin) {
    const pinyinEl = document.createElement('p');
    pinyinEl.textContent = entry.pinyin;
    pinyinEl.className = 'text-base italic not-eink:opacity-85';
    hgroup.append(pinyinEl);
  }

  const langEl = document.createElement('p');
  langEl.textContent = 'Chinese';
  langEl.className = 'text-sm italic not-eink:opacity-75';
  hgroup.append(langEl);
  container.append(hgroup);

  entry.definitions.forEach(({ partOfSpeech, meanings }) => {
    const h2 = document.createElement('h2');
    h2.textContent = partOfSpeech;
    h2.className = 'text-base font-semibold mt-4';
    const ol = document.createElement('ol');
    ol.className = 'pl-8 list-decimal';
    meanings.forEach((meaning) => {
      const li = document.createElement('li');
      li.textContent = meaning;
      ol.appendChild(li);
    });
    container.appendChild(h2);
    container.appendChild(ol);
  });

  return { ok: true, headword: entry.word, sourceLabel: 'Wiktionary (CC BY-SA)' };
};

const renderWiktionary = async (
  word: string,
  language: string | undefined,
  container: HTMLElement,
  signal: AbortSignal,
  onNavigate?: (word: string) => void,
): Promise<DictionaryLookupOutcome> => {
  const response = await fetch(
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
    { signal },
  );
  if (!response.ok) {
    return { ok: false, reason: 'error', message: `HTTP ${response.status}` };
  }
  const json = await response.json();
  if (signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
  const results: Result[] | undefined = language
    ? json[language] || json['en']
    : json[Object.keys(json)[0]!];
  if (!results || results.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const hgroup = document.createElement('hgroup');
  const h1 = document.createElement('h1');
  h1.textContent = word;
  h1.className = 'text-lg font-bold';
  const p = document.createElement('p');
  p.textContent = results[0]!.language;
  p.className = 'text-sm italic not-eink:opacity-75';
  hgroup.append(h1, p);
  container.append(hgroup);

  results.forEach(({ partOfSpeech, definitions }: Result) => {
    const h2 = document.createElement('h2');
    h2.textContent = partOfSpeech;
    h2.className = 'text-base font-semibold mt-4';
    const ol = document.createElement('ol');
    ol.className = 'pl-8 list-decimal';
    definitions.forEach(({ definition, examples }: Definition) => {
      if (!definition) return;
      const li = document.createElement('li');
      const processed = interceptDictLinks(definition, onNavigate);
      li.append(...processed);
      if (examples) {
        const ul = document.createElement('ul');
        ul.className = 'pl-8 list-disc text-sm italic not-eink:opacity-75';
        examples.forEach((example) => {
          const exampleLi = document.createElement('li');
          exampleLi.innerHTML = example;
          ul.appendChild(exampleLi);
        });
        li.appendChild(ul);
      }
      ol.appendChild(li);
    });
    container.appendChild(h2);
    container.appendChild(ol);
  });

  return { ok: true, headword: word, sourceLabel: 'Wiktionary (CC BY-SA)' };
};

export const wiktionaryProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.wiktionary,
  kind: 'builtin',
  label: _('Wiktionary'),
  async lookup(word, ctx) {
    const langCode = typeof ctx.lang === 'string' ? ctx.lang : ctx.lang?.[0];
    const isChinese = langCode ? normalizedLangCode(langCode) === 'zh' : false;
    try {
      if (isChinese) {
        return await renderChinese(word, ctx.container, ctx.signal);
      }
      return await renderWiktionary(word, langCode, ctx.container, ctx.signal, ctx.onNavigate);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error('Wiktionary lookup failed', error);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
