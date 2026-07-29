import { expect, test } from 'vitest';

import { createLibrarySearchWorker } from '@/services/librarySearchWorker';

const nearbyOptions = {
  locale: 'en',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 5,
};

test('runs searches in the module worker and restarts after cancellation', async () => {
  const searchWorker = createLibrarySearchWorker();

  const nearbyResult = await searchWorker.search({
    sectionKey: 'nearby',
    text: 'alpha one beta gap',
    query: 'alpha beta',
    mode: 'nearby-words',
    fuzzyOptions: { matchCase: false, matchDiacritics: false },
    nearbyOptions,
    limit: 500,
  });
  expect(nearbyResult.truncated).toBe(false);
  expect(nearbyResult.matches).toEqual([
    {
      start: 0,
      end: 14,
      runs: [
        { start: 0, end: 5 },
        { start: 10, end: 14 },
      ],
    },
  ]);

  const controller = new AbortController();
  const aborted = searchWorker.search(
    {
      sectionKey: 'large',
      text: 'alpha '.repeat(500_000),
      query: 'omega',
      mode: 'fuzzy',
      fuzzyOptions: { matchCase: false, matchDiacritics: false },
      nearbyOptions,
      limit: 500,
    },
    controller.signal,
  );
  controller.abort();
  await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

  await expect(
    searchWorker.search({
      sectionKey: 'fuzzy',
      text: 'UserAuthController',
      query: 'UserController',
      mode: 'fuzzy',
      fuzzyOptions: { matchCase: false, matchDiacritics: false },
      nearbyOptions,
      limit: 500,
    }),
  ).resolves.toEqual({
    truncated: false,
    matches: [
      {
        start: 0,
        end: 18,
        runs: [
          { start: 0, end: 4 },
          { start: 8, end: 18 },
        ],
        typoCount: 0,
      },
    ],
  });

  searchWorker.close();
});
