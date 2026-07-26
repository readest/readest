import { searchManga } from '@/services/mangadex/search';
import { describe, it, expect, vi } from 'vitest';

describe('search', () => {
  const fakeResponse = {
    result: 'ok',
    response: 'collection',
    data: [
      {
        id: 'fcb5111f-be88-4f5a-b456-22135f3eda49',
        type: 'manga',
        attributes: {
          title: { en: 'ONE PIECE STRONG WORLD' },
          altTitles: [{ en: 'One Piece: Strong World' }, { en: 'One PIece Volume 0' }],
          description: {
            en: 'One Piece: Strong World is a free volume distributed to the first 1.5 million attendees of the fillm bearing the same name. Icluded is the special prologue chapter. Chapter 0 depicts events 20 years before the current timeline of the manga. The main focus is the relationship between Shiki, the Golden Lion and Roger, the Pirate King. In addition, it shows what other characters were doing 20 years ago.',
            'pt-br':
              'One-Shot pr\u00f3logo do filme Strong World que se passa 20 anos antes dos acontecimentos do filme. Focado na rela\u00e7\u00e3o do Shiki, O Le\u00e3o Dourado e Gol D. Roger, O Rei dos Piratas.',
          },
          isLocked: false,
          links: { al: '47152', ap: 'one-piece-strong-world-0', kt: '4194', mal: '17152' },
          officialLinks: null,
          originalLanguage: 'ja',
          lastVolume: '0',
          lastChapter: '0',
          publicationDemographic: 'shounen',
          status: 'completed',
          year: 2009,
          contentRating: 'safe',
          tags: [
            {
              id: '391b0423-d847-456f-aff0-8b0cfc03066b',
              type: 'tag',
              attributes: { name: { en: 'Action' }, description: {}, group: 'genre', version: 1 },
              relationships: [],
            },
            {
              id: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
              type: 'tag',
              attributes: { name: { en: 'Comedy' }, description: {}, group: 'genre', version: 1 },
              relationships: [],
            },
            {
              id: '87cc87cd-a395-47af-b27a-93258283bbc6',
              type: 'tag',
              attributes: {
                name: { en: 'Adventure' },
                description: {},
                group: 'genre',
                version: 1,
              },
              relationships: [],
            },
          ],
          state: 'published',
          chapterNumbersResetOnNewVolume: false,
          createdAt: '2018-06-21T15:11:36+00:00',
          updatedAt: '2023-08-15T18:06:34+00:00',
          version: 6,
          availableTranslatedLanguages: ['vi', 'en', 'ru', 'pl', 'eu', 'ca', 'pt-br'],
          latestUploadedChapter: 'a97e9b7a-dcab-49f3-9bf7-f8e41fa47f18',
        },
        relationships: [
          { id: 'b6045e2c-28f4-4ce0-b4dd-b14070f2f5ae', type: 'author' },
          { id: 'b6045e2c-28f4-4ce0-b4dd-b14070f2f5ae', type: 'artist' },
          { id: '3b441fd3-023d-4f96-9e58-e11312421f45', type: 'cover_art' },
          { id: 'a1c7c817-4e59-43b7-9365-09675a149a6f', type: 'manga', related: 'adapted_from' },
          { id: 'a1c7c817-4e59-43b7-9365-09675a149a6f', type: 'manga', related: 'sequel' },
        ],
      },
    ],
    limit: 10,
    offset: 0,
    total: 1,
  };

  describe('searchManga', () => {
    it('parses response correctly', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            json: () => Promise.resolve(fakeResponse),
          }),
        ),
      );

      const manga = await searchManga('one piece');
      const firstManga = manga[0]!;

      expect(manga).toHaveLength(1);
      expect(firstManga).toBeDefined();
      expect(firstManga.id).toBe('fcb5111f-be88-4f5a-b456-22135f3eda49');
    });

    it('returns empty array when no manga found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            json: () =>
              Promise.resolve({
                ...fakeResponse,
                data: [],
              }),
          }),
        ),
      );

      const manga = await searchManga('does not exist');

      expect(manga).toEqual([]);
    });
  });
});
