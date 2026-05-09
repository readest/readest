/**
 * Built-in web-search templates.
 *
 * Three universally-useful entries (Google, Urban Dictionary,
 * Merriam-Webster). They are seeded into `providerOrder` but **disabled by
 * default** — users opt in from the settings list. Custom URL templates
 * live in `settings.webSearches`; this file is only the immutable
 * built-ins.
 *
 * The `%WORD%` placeholder marks where the looked-up word goes; the
 * provider URL-encodes it at substitution time. (GoldenDict users may know
 * `%GDWORD%` from there — we use `%WORD%` for brevity, but accept neither
 * verbatim variant beyond what's documented here.)
 */
import { BUILTIN_WEB_SEARCH_IDS, type WebSearchEntry } from './types';

export interface BuiltinWebSearchTemplate extends WebSearchEntry {
  /** Localizable display name key — passed through `_(...)` at render time. */
  nameKey: string;
}

export const BUILTIN_WEB_SEARCHES: BuiltinWebSearchTemplate[] = [
  {
    id: BUILTIN_WEB_SEARCH_IDS.google,
    name: 'Google',
    nameKey: 'Google',
    urlTemplate: 'https://www.google.com/search?q=define:%WORD%&hl=en',
  },
  {
    id: BUILTIN_WEB_SEARCH_IDS.urban,
    name: 'Urban Dictionary',
    nameKey: 'Urban Dictionary',
    urlTemplate: 'https://www.urbandictionary.com/define.php?term=%WORD%',
  },
  {
    id: BUILTIN_WEB_SEARCH_IDS.merriamWebster,
    name: 'Merriam-Webster',
    nameKey: 'Merriam-Webster',
    urlTemplate: 'https://www.merriam-webster.com/dictionary/%WORD%',
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_WEB_SEARCHES.map((t) => [t.id, t]));

export const getBuiltinWebSearch = (id: string): BuiltinWebSearchTemplate | undefined =>
  BUILTIN_BY_ID.get(id);

/**
 * Substitute `%WORD%` (case-insensitive) in a URL template with the
 * URL-encoded form of `word`. Also handles the doubly-escaped form
 * `%25WORD%25` that may appear if a user pasted a URL through a tool that
 * percent-encoded the placeholder.
 */
export const substituteUrlTemplate = (template: string, word: string): string => {
  const encoded = encodeURIComponent(word);
  return template.replace(/%25WORD%25/gi, encoded).replace(/%WORD%/gi, encoded);
};

/** Returns true if a template contains a usable `%WORD%` placeholder. */
export const isValidUrlTemplate = (template: string): boolean => {
  if (!/^https?:\/\//i.test(template.trim())) return false;
  return /%WORD%/i.test(template) || /%25WORD%25/i.test(template);
};
