export type BookGenre =
  | 'fiction'
  | 'fantasy'
  | 'sci-fi'
  | 'mystery'
  | 'romance'
  | 'non-fiction'
  | 'history'
  | 'biography'
  | 'unknown';

export interface GenreHints {
  readonly genre: BookGenre;
  readonly hints: readonly string[];
  readonly extractionFocus: readonly string[];
}

export interface GenreMetadata {
  readonly subject?: readonly string[];
  readonly description?: string;
  readonly title?: string;
}

type ClassifiedGenre = Exclude<BookGenre, 'unknown'>;

const GENRE_ORDER: readonly ClassifiedGenre[] = [
  'fantasy',
  'sci-fi',
  'mystery',
  'romance',
  'history',
  'biography',
  'non-fiction',
  'fiction',
];

const GENRE_KEYWORDS: Record<ClassifiedGenre, readonly string[]> = {
  fantasy: ['fantasy', 'magic', 'wizard', 'dragon', 'sorcery', 'realm', 'spell', 'fae'],
  'sci-fi': [
    'science fiction',
    'sci-fi',
    'scifi',
    'space',
    'alien',
    'robot',
    'dystopian',
    'cyberpunk',
    'android',
    'galaxy',
    'time travel',
  ],
  mystery: ['mystery', 'detective', 'crime', 'murder', 'investigation', 'noir', 'clue'],
  romance: ['romance', 'love', 'relationship', 'wedding', 'passion', 'romcom'],
  history: ['history', 'historical', 'ancient', 'medieval', 'revolution', 'empire', 'dynasty'],
  biography: ['biography', 'memoir', 'autobiography', 'life story'],
  'non-fiction': [
    'non-fiction',
    'nonfiction',
    'essay',
    'journalism',
    'guide',
    'manual',
    'self-help',
    'business',
    'science',
    'philosophy',
    'psychology',
    'economics',
    'politics',
    'sociology',
    'how to',
    'case study',
  ],
  fiction: ['fiction', 'novel', 'story', 'literary', 'adventure', 'horror', 'poetry'],
};

const HINTS: Record<BookGenre, GenreHints> = {
  fantasy: {
    genre: 'fantasy',
    hints: [
      'Focus on magic systems, factions, and mythical creatures',
      'Track character lineages and prophecies',
      'Identify key artifacts and magical items',
    ],
    extractionFocus: ['factions', 'magic systems', 'artifacts', 'lineage', 'prophecy'],
  },
  'sci-fi': {
    genre: 'sci-fi',
    hints: [
      'Focus on technology, scientific concepts, and institutions',
      'Track space locations and spacecraft',
      'Identify key experiments and discoveries',
    ],
    extractionFocus: ['technology', 'institutions', 'terminology', 'locations', 'concepts'],
  },
  mystery: {
    genre: 'mystery',
    hints: [
      'Focus on suspects, clues, and motives',
      'Track alibis and timelines carefully',
      'Identify key evidence and red herrings',
    ],
    extractionFocus: ['suspects', 'clues', 'motives', 'alibis', 'evidence'],
  },
  romance: {
    genre: 'romance',
    hints: [
      'Focus on emotional states and relationship development',
      'Track romantic moments and conflicts',
      'Identify obstacles to the relationship',
    ],
    extractionFocus: ['emotions', 'relationships', 'conflicts', 'moments', 'obstacles'],
  },
  history: {
    genre: 'history',
    hints: [
      'Focus on historical events and figures',
      'Track timelines and causation',
      'Identify key documents and sources',
    ],
    extractionFocus: ['events', 'figures', 'dates', 'causes', 'documents'],
  },
  biography: {
    genre: 'biography',
    hints: [
      'Focus on life events and personal relationships',
      'Track career progression and achievements',
      'Identify influential people and mentors',
    ],
    extractionFocus: ['events', 'relationships', 'achievements', 'career', 'influences'],
  },
  'non-fiction': {
    genre: 'non-fiction',
    hints: [
      'Focus on key concepts and definitions',
      'Track arguments and evidence',
      'Identify important claims and conclusions',
    ],
    extractionFocus: ['concepts', 'definitions', 'arguments', 'evidence', 'claims', 'sources'],
  },
  fiction: {
    genre: 'fiction',
    hints: [
      'Focus on character development and plot progression',
      'Track character arcs and conflicts',
      'Identify turning points and conflicts',
    ],
    extractionFocus: ['characters', 'plot', 'conflicts', 'development'],
  },
  unknown: {
    genre: 'unknown',
    hints: ['Extract all relevant entities and relationships'],
    extractionFocus: ['entities', 'relationships', 'events'],
  },
};

export const getGenreHints = (genre: BookGenre): GenreHints => {
  const hints = HINTS[genre];
  return {
    genre: hints.genre,
    hints: [...hints.hints],
    extractionFocus: [...hints.extractionFocus],
  };
};

const scoreText = (text: string, weight: number, scores: Map<ClassifiedGenre, number>): void => {
  const normalized = text.normalize('NFKC').toLowerCase();
  for (const genre of GENRE_ORDER) {
    for (const keyword of GENRE_KEYWORDS[genre]) {
      if (normalized.includes(keyword)) {
        scores.set(genre, (scores.get(genre) ?? 0) + weight);
      }
    }
  }
};

export const detectGenre = (metadata: GenreMetadata): GenreHints => {
  const scores = new Map<ClassifiedGenre, number>();
  for (const subject of metadata.subject ?? []) scoreText(subject, 2, scores);
  scoreText(metadata.description ?? '', 1, scores);
  scoreText(metadata.title ?? '', 1, scores);

  let bestGenre: ClassifiedGenre = 'fiction';
  let bestScore = 0;
  for (const genre of GENRE_ORDER) {
    const score = scores.get(genre) ?? 0;
    if (score > bestScore) {
      bestGenre = genre;
      bestScore = score;
    }
  }
  return getGenreHints(bestGenre);
};
