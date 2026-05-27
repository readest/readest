/**
 * Web-search provider.
 *
 * Renders an "Open in [name]" card inside the popup tab. The `<a href="…">`
 * uses the same pattern as `wikipediaProvider`'s "Read on Wikipedia" link,
 * so the popup's container click delegation routes the click through
 * Tauri's `openUrl` on native and `target="_blank"` works on the web build.
 *
 * Iframe embedding was considered and rejected — Google, Urban Dictionary,
 * and Merriam-Webster all set `X-Frame-Options: DENY/SAMEORIGIN`. v1
 * pragmatically opens externally; a Tauri-native webview overlay is a
 * follow-up if there's demand.
 */
import type { DictionaryProvider, WebSearchEntry } from '../types';
import { substituteUrlTemplate } from '../webSearchTemplates';
import { isTauriAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';

const isTauri = isTauriAppPlatform();

export interface CreateWebSearchProviderArgs {
  template: WebSearchEntry;
  /** Override the displayed label (e.g. localized built-in name). */
  label?: string;
}

export const createWebSearchProvider = ({
  template,
  label,
}: CreateWebSearchProviderArgs): DictionaryProvider => ({
  id: template.id,
  kind: 'web',
  label: label ?? template.name,
  async lookup(word, ctx) {
    if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };

    const url = substituteUrlTemplate(template.urlTemplate, trimmed);

    const hgroup = document.createElement('hgroup');
    const h1 = document.createElement('h1');
    h1.textContent = trimmed;
    h1.className = 'text-lg font-bold';
    hgroup.append(h1);
    const sub = document.createElement('p');
    sub.textContent = template.name;
    sub.className = 'text-sm italic not-eink:opacity-75';
    hgroup.append(sub);
    ctx.container.append(hgroup);

    const description = document.createElement('p');
    description.className = 'mt-3 text-sm';
    description.textContent = _('Open the search result in your browser:');
    ctx.container.append(description);

    const linkWrapper = document.createElement('p');
    linkWrapper.className = 'mt-3';
    const link = document.createElement('a');
    link.href = url;
    // Skip target="_blank" on Tauri; the popup's click delegation routes
    // through `openUrl`. iOS WebView's _blank handling fails otherwise.
    if (!isTauri) link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className =
      'btn btn-sm btn-primary normal-case text-primary-content not-eink:no-underline';
    // `stubTranslation` is just an extraction marker — the runtime value is
    // the key itself. We interpolate the provider name manually.
    link.textContent = _('Open in {{name}}').replace('{{name}}', template.name);
    linkWrapper.append(link);
    ctx.container.append(linkWrapper);

    const urlPreview = document.createElement('p');
    urlPreview.className = 'mt-3 text-base-content/60 break-all text-xs';
    urlPreview.textContent = url;
    ctx.container.append(urlPreview);

    return { ok: true, headword: trimmed, sourceLabel: template.name };
  },
});
