import type { FoliateView } from '@/types/view';

type SearchHighlightView = Pick<FoliateView, 'search' | 'clearSearch'>;

export const showTransientSearchHighlight = async (view: SearchHighlightView, cfi: string) => {
  const results = view.search({
    scope: 'book',
    mode: 'contains',
    matchCase: false,
    matchDiacritics: false,
    results: [{ cfi, excerpt: { pre: '', match: '', post: '' } }],
  });
  for await (const _ of results) {
    // Consume the generator so Foliate installs the search annotation.
  }
  return setTimeout(() => view.clearSearch(), 4000);
};
