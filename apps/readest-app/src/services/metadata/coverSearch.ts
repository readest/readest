import { substituteUrlTemplate } from '@/services/dictionaries/webSearchTemplates';

export interface CoverSearchEngine {
  id: string;
  name: string;
  urlTemplate: string;
}

export const BUILTIN_COVER_SEARCH_ENGINES: CoverSearchEngine[] = [
  { id: 'google', name: 'Google', urlTemplate: 'https://www.google.com/search?udm=2&q=%WORD%' },
  { id: 'bing', name: 'Bing', urlTemplate: 'https://www.bing.com/images/search?q=%WORD%' },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    urlTemplate: 'https://duckduckgo.com/?q=%WORD%&iax=images&ia=images',
  },
];

export const getCoverSearchUrl = (engine: CoverSearchEngine, query: string): string =>
  substituteUrlTemplate(engine.urlTemplate, query);

export const isValidCoverSearchTemplate = (template: string): boolean => {
  if (!/%WORD%|%25WORD%25/i.test(template)) return false;
  try {
    const url = new URL(substituteUrlTemplate(template, 'book cover'));
    return (
      ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password
    );
  } catch {
    return false;
  }
};
