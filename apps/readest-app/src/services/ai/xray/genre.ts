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
  genre: BookGenre;
  hints: string[];
  extractionFocus: string[];
}

export function detectGenre(metadata: {
  subject?: string[];
  description?: string;
  title?: string;
}): GenreHints {
  const subjects = metadata.subject || [];
  const description = (metadata.description || '').toLowerCase();
  const title = (metadata.title || '').toLowerCase();

  const combinedText = [...subjects, description, title].join(' ').toLowerCase();

  const genreKeywords: Record<BookGenre, string[]> = {
    fantasy: [
      'fantasy',
      'magic',
      'wizard',
      'dragon',
      'sword',
      'sorcery',
      'mythical',
      'realm',
      'spell',
      'kingdom',
      'myth',
      'fae',
    ],
    'sci-fi': [
      'science fiction',
      'sci-fi',
      'scifi',
      'space',
      'future',
      'alien',
      'robot',
      'technology',
      'dystopian',
      'cyberpunk',
      'android',
      'galaxy',
      'time travel',
    ],
    mystery: [
      'mystery',
      'detective',
      'crime',
      'murder',
      'investigation',
      'thriller',
      'suspense',
      'noir',
      'case',
    ],
    romance: ['romance', 'love', 'relationship', 'wedding', 'heart', 'passion', 'romcom'],
    history: [
      'history',
      'historical',
      'war',
      'century',
      'ancient',
      'medieval',
      'victorian',
      'revolution',
      'empire',
      'dynasty',
    ],
    biography: ['biography', 'memoir', 'autobiography', 'life story'],
    'non-fiction': [
      'non-fiction',
      'nonfiction',
      'essay',
      'journalism',
      'documentary',
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
      'technology',
      'how to',
      'case study',
    ],
    fiction: ['fiction', 'novel', 'story', 'literary', 'adventure', 'horror', 'thriller', 'poetry'],
    unknown: [],
  };

  const scores: Record<BookGenre, number> = {
    fantasy: 0,
    'sci-fi': 0,
    mystery: 0,
    romance: 0,
    history: 0,
    biography: 0,
    'non-fiction': 0,
    fiction: 0,
    unknown: 0,
  };

  for (const [genre, keywords] of Object.entries(genreKeywords)) {
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = combinedText.match(regex);
      if (matches) {
        scores[genre as BookGenre] += matches.length;
      }
    }
  }

  let detectedGenre: BookGenre = 'unknown';
  let maxScore = 0;

  for (const [genre, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedGenre = genre as BookGenre;
    }
  }

  if (detectedGenre === 'unknown' || maxScore < 2) {
    detectedGenre = 'fiction';
  }

  return getGenreHints(detectedGenre);
}

export function getGenreHints(genre: BookGenre): GenreHints {
  const hintsMap: Record<BookGenre, GenreHints> = {
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

  return hintsMap[genre];
}
