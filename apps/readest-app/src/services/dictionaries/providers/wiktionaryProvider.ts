/**
 * Built-in Wiktionary provider.
 *
 * Looks up the headword in en.wiktionary.org's REST API. For CJK headwords
 * (lang code starts with `zh`/`zho`), falls back to {@link fetchChineseDefinition}
 * which scrapes Wiktionary's wikitext for pinyin + meanings.
 *
 * For other non-English books, the entry comes from the book language's own
 * edition (e.g. es.wiktionary.org) so definitions are written in that language
 * (#6529). Only en.wiktionary exposes the structured definition endpoint, so
 * this path parses the page HTML and keeps the section headed by the
 * language's own name. It falls back to English Wiktionary when the edition
 * is unreachable or has no such entry.
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

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const NOISE_SELECTOR = [
  'style',
  'link',
  'script',
  'table',
  'figure',
  'img',
  'audio',
  'video',
  'sup.reference',
  '.mw-references-wrap',
  // Translation/phrase boxes; collapsibles nested in a definition hold its examples.
  '.mw-parser-output > .mw-collapsible',
  '.noprint',
].join(', ');

const headingLevel = (el: Element): number => {
  const heading = el.matches(HEADING_SELECTOR)
    ? el
    : el.classList.contains('mw-heading')
      ? el.querySelector(HEADING_SELECTOR)
      : null;
  return heading ? Number(heading.tagName[1]) : 0;
};

// Space-delimited words so `deutsch` matches "Haus (Deutsch)" but not "Niederdeutsch".
const toWords = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}]+/gu, ' ')
    .trim()} `;

const renderNativeWiktionary = async (
  word: string,
  lang: string,
  container: HTMLElement,
  signal: AbortSignal,
  onNavigate?: (word: string) => void,
): Promise<DictionaryLookupOutcome | null> => {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    origin: '*',
    redirects: '1',
    prop: 'text',
    disableeditsection: '1',
    disabletoc: '1',
    page: word,
  });
  const response = await fetch(`https://${lang}.wiktionary.org/w/api.php?${params}`, { signal });
  if (!response.ok) return null;
  const json = await response.json();
  const html: string | undefined = json.parse?.text;
  if (!html) return null;

  const languageName = new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
  const target = toWords(languageName);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
  const root = doc.querySelector('.mw-parser-output') ?? doc.body;

  const blocks: Element[] = [];
  let sectionLevel = 0;
  let inSection = false;
  for (const el of Array.from(root.children)) {
    const level = headingLevel(el);
    if (level && (!sectionLevel || level <= sectionLevel)) {
      inSection = toWords(el.textContent ?? '').includes(target);
      if (inSection) sectionLevel = level;
      continue;
    }
    if (inSection && (level || el.textContent?.trim())) blocks.push(el);
  }
  // A heading is worth keeping only if content follows before the next heading at its level.
  const hasContent = (i: number) => {
    const level = headingLevel(blocks[i]!);
    for (const next of blocks.slice(i + 1)) {
      const nextLevel = headingLevel(next);
      if (!nextLevel) return true;
      if (nextLevel <= level) return false;
    }
    return false;
  };
  const kept = blocks.filter((el, i) => !headingLevel(el) || hasContent(i));
  if (!kept.some((el) => !headingLevel(el))) return null;
  if (signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };

  const topLevel = Math.min(...kept.map(headingLevel).filter(Boolean));
  const section = document.createElement('div');
  section.lang = root.getAttribute('lang') ?? lang;
  section.dir = root.getAttribute('dir') ?? '';
  kept.forEach((el) => {
    const level = headingLevel(el);
    if (!level) {
      section.append(el);
      return;
    }
    const heading = document.createElement(level === topLevel ? 'h2' : 'h3');
    heading.textContent = el.textContent?.trim() ?? '';
    heading.className =
      level === topLevel ? 'text-base font-semibold mt-4' : 'text-sm font-semibold mt-3';
    section.append(heading);
  });
  section.querySelectorAll('ol').forEach((el) => (el.className = 'ps-8 list-decimal'));
  section.querySelectorAll('ul').forEach((el) => (el.className = 'ps-8 list-disc'));
  section.querySelectorAll('dd').forEach((el) => (el.className = 'ps-4'));
  section.querySelectorAll('a').forEach((link) => {
    const title = link.getAttribute('title');
    if (!title || title.includes(':') || !link.getAttribute('href')?.startsWith('/wiki/')) {
      link.replaceWith(...Array.from(link.childNodes));
      return;
    }
    link.addEventListener('click', (event) => {
      event.preventDefault();
      onNavigate?.(title);
    });
    link.className = 'not-eink:text-primary underline cursor-pointer';
  });

  const headword: string = json.parse.title ?? word;
  const hgroup = document.createElement('hgroup');
  const h1 = document.createElement('h1');
  h1.textContent = headword;
  h1.className = 'text-lg font-bold';
  const p = document.createElement('p');
  p.textContent = languageName.charAt(0).toLocaleUpperCase(lang) + languageName.slice(1);
  p.className = 'text-sm italic not-eink:opacity-75';
  hgroup.append(h1, p);
  container.append(hgroup, section);

  return { ok: true, headword, sourceLabel: 'Wiktionary (CC BY-SA)' };
};

export const wiktionaryProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.wiktionary,
  kind: 'builtin',
  label: _('Wiktionary'),
  async lookup(word, ctx) {
    const langCode = typeof ctx.lang === 'string' ? ctx.lang : ctx.lang?.[0];
    const lang = normalizedLangCode(langCode);
    try {
      if (lang === 'zh') {
        return await renderChinese(word, ctx.container, ctx.signal);
      }
      // The code comes from book metadata and becomes the request host, so only
      // a plain ISO 639 code may pick an edition.
      if (/^[a-z]{2,3}$/.test(lang) && lang !== 'en') {
        try {
          const outcome = await renderNativeWiktionary(
            word,
            lang,
            ctx.container,
            ctx.signal,
            ctx.onNavigate,
          );
          if (outcome) return outcome;
        } catch (error) {
          if ((error as { name?: string }).name === 'AbortError') throw error;
          console.warn(`${lang}.wiktionary lookup failed, falling back to English`, error);
        }
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
