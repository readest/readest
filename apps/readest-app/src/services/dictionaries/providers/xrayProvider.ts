/**
 * Built-in X-Ray (#2709): who or what a name is, from what the book has said
 * up to the page being read. It looks only at what was already read into the
 * X-Ray, so a lookup asks no AI; it is gated like the Context Dictionary.
 */
import i18n from '@/i18n/i18n';
import type { XRay } from '@/services/xray/snapshot';
import type { XRayEntity } from '@/services/xray/types';
import { getBookXRay, isXRayAvailable, openQuote } from '@/services/xray/xrayService';
import type { DictionaryProvider } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';

const _ = (key: string) => i18n.t(key, { defaultValue: key });

const append = <K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className: string,
  text = '',
) => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  parent.append(el);
  return el;
};

const renderEntity = (container: HTMLElement, bookKey: string, xray: XRay, entity: XRayEntity) => {
  container.replaceChildren();
  append(container, 'h1', 'text-lg font-bold', entity.name);
  if (entity.aliases.length) {
    append(
      container,
      'p',
      'text-sm italic not-eink:opacity-75',
      `${_('Also known as')}: ${entity.aliases.join(', ')}`,
    );
  }
  if (entity.description) append(container, 'p', 'mt-2', entity.description);
  const links = xray.linksOf(entity);
  if (entity.facts.length || links.length) {
    const list = append(container, 'ul', 'mt-2 list-disc ps-6');
    for (const { key, value } of entity.facts) append(list, 'li', '', `${key}: ${value}`);
    for (const { relationship, other } of links) {
      const item = append(list, 'li', '');
      const text = `${relationship.source} · ${relationship.type} · ${relationship.target}`;
      if (!other) {
        item.textContent = text;
        continue;
      }
      const link = append(item, 'button', 'text-start underline', text);
      link.type = 'button';
      link.onclick = () => renderEntity(container, bookKey, xray, other);
    }
  }
  for (const { text, cfi } of entity.quotes) {
    const quote = append(
      container,
      'button',
      'mt-2 block text-start text-sm italic not-eink:opacity-75',
      `“${text}”`,
    );
    quote.type = 'button';
    quote.title = _('Jump to quote');
    quote.onclick = () => openQuote(bookKey, cfi);
  }
};

export const xrayProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.xray,
  kind: 'builtin',
  label: 'X-Ray',
  async lookup(word, { container, selection, signal }) {
    const bookKey = selection?.bookKey;
    if (!bookKey || !isXRayAvailable()) return { ok: false, reason: 'unsupported' };
    const xray = await getBookXRay(bookKey);
    if (signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
    const entity = xray?.find(word);
    if (!xray || !entity) return { ok: false, reason: 'empty' };
    renderEntity(container, bookKey, xray, entity);
    return { ok: true, headword: entity.name, sourceLabel: _('X-Ray') };
  },
};
