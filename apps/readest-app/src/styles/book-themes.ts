import type { OrnamentStyle } from './ornaments';
import type { Book } from '@/types/book';
import type { Contributor } from '@/utils/book';

function contributorToString(c: string | Contributor): string {
  if (typeof c === 'string') return c;
  const nameMap = c.name;
  const firstValue = Object.values(nameMap)[0];
  return firstValue ?? '';
}

function extractSubjects(book: Book): string[] | undefined {
  const subject = book.metadata?.subject;
  if (!subject) return undefined;
  if (typeof subject === 'string') return [subject];
  if (Array.isArray(subject)) {
    return subject.map(contributorToString).filter(Boolean);
  }
  const name = contributorToString(subject);
  return name ? [name] : undefined;
}

function toBookMatchMetadata(book: Book): BookMatchMetadata {
  return {
    title: book.title ?? '',
    author: book.author ?? undefined,
    subjects: extractSubjects(book),
    language: book.primaryLanguage ?? undefined,
    publisher: book.metadata?.publisher ?? undefined,
  };
}

export interface BookThemeConfig {
  /** Unique key for the book theme */
  id: string;
  /** Display label */
  label: string;
  /** Ornament style to use for chapter decorations */
  ornamentStyle: OrnamentStyle;
  /** Whether to show house sigils in chapter headers */
  useSigils: boolean;
  /** Background texture ID — references textures.ts predefined or custom textures */
  textureId?: string;
  /** Path to a custom reader book image (replaces the default frame) */
  readerBookImage?: string;
  /** Path to a main menu book image */
  menuBookImage?: string;
  /** Alternate menu book image (side/angled view) */
  menuBookImageSide?: string;
  /** CSS blend mode for the texture overlay */
  textureBlendMode?: string;
  /** Texture opacity (0–1) */
  textureOpacity?: number;
}

/**
 * Matcher functions to determine which theme applies to a given book.
 * Tests are run in order — the first match wins.
 */
export interface BookThemeMatcher {
  /** Fallback theme when no others match */
  id: string;
  /** Function that returns true if this theme should apply to the given book */
  matches: (metadata: BookMatchMetadata) => boolean;
}

export interface BookMatchMetadata {
  title: string;
  author?: string;
  subjects?: string[];
  language?: string;
  publisher?: string;
}

const isAsOIAFBook = (m: BookMatchMetadata): boolean => {
  const title = m.title.toLowerCase();
  const author = (m.author ?? '').toLowerCase();
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());

  if (author.includes('george') && author.includes('martin')) return true;

  if (
    subjects.some(
      (s) => s.includes('song of ice and fire') || s.includes('westeros') || s.includes('asoiaf'),
    )
  ) {
    return true;
  }

  const gotTitles = [
    'a game of thrones',
    'a clash of kings',
    'a storm of swords',
    'a feast for crows',
    'a dance with dragons',
    'the winds of winter',
    'fire & blood',
    'fire and blood',
    'a knight of the seven kingdoms',
    'the world of ice & fire',
    'the rise of the dragon',
  ];

  return gotTitles.some((t) => title.includes(t));
};

const isDarkFantasy = (m: BookMatchMetadata): boolean => {
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());
  // Must contain an explicit dark-fantasy signal — "dark fantasy",
  // "grimdark", or "low fantasy". Generic "fantasy + medieval" is NOT
  // dark fantasy (most high fantasy uses medieval settings).
  return subjects.some(
    (s) =>
      s.includes('dark fantasy') ||
      s.includes('grimdark') ||
      s.includes('grim dark') ||
      s.includes('low fantasy'),
  );
};

const isFantasy = (m: BookMatchMetadata): boolean => {
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());
  return subjects.some(
    (s) =>
      s.includes('fantasy') ||
      s.includes('fiction / fantasy') ||
      s.includes('epic fantasy') ||
      s.includes('high fantasy') ||
      s.includes('heroic fantasy') ||
      s.includes('urban fantasy') ||
      s.includes('sword & sorcery') ||
      s.includes('sword and sorcery') ||
      s.includes('magic') ||
      s.includes('wizards') ||
      s.includes('dragons'),
  );
};

const isSciFiBook = (m: BookMatchMetadata): boolean => {
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());
  return subjects.some(
    (s) =>
      s.includes('science fiction') ||
      s.includes('sci-fi') ||
      s.includes('space opera') ||
      s.includes('cyberpunk'),
  );
};

const isHorror = (m: BookMatchMetadata): boolean => {
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());
  return subjects.some((s) => s.includes('horror') || s.includes('gothic'));
};

const isMysteryThriller = (m: BookMatchMetadata): boolean => {
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());
  return subjects.some(
    (s) =>
      s.includes('mystery') ||
      s.includes('thriller') ||
      s.includes('detective') ||
      s.includes('noir'),
  );
};

const isHistoricalOrClassic = (m: BookMatchMetadata): boolean => {
  const subjects = (m.subjects ?? []).map((s) => s.toLowerCase());
  return subjects.some(
    (s) =>
      s.includes('historical') ||
      s.includes('classic') ||
      s.includes('literary') ||
      s.includes('19th century') ||
      s.includes('victorian') ||
      s.includes('romance historical'),
  );
};

// Order matters — most specific matchers run first.
// 1. got            → ASOIAF (specific series identification)
// 2. darkFantasy    → "dark fantasy" / "grimdark" / dark-medieval fantasy subset
// 3. scifi          → sci-fi / cyberpunk
// 4. gothic         → horror / gothic
// 5. fantasy        → generic fantasy / magic / sword & sorcery (catch-all fantasy)
// 6. mystery        → mystery / thriller / noir
// 7. elegant        → historical / classic / literary
// Falls through to default (celestial) when nothing matches.
export const BOOK_THEME_MATCHERS: BookThemeMatcher[] = [
  {
    id: 'got',
    matches: isAsOIAFBook,
  },
  {
    id: 'darkFantasy',
    matches: isDarkFantasy,
  },
  {
    id: 'scifi',
    matches: isSciFiBook,
  },
  {
    id: 'gothic',
    matches: isHorror,
  },
  {
    id: 'fantasy',
    matches: isFantasy,
  },
  {
    id: 'mystery',
    matches: isMysteryThriller,
  },
  {
    id: 'elegant',
    matches: isHistoricalOrClassic,
  },
];

export const BOOK_THEME_CONFIGS: Record<string, BookThemeConfig> = {
  default: {
    id: 'default',
    label: 'Citadel',
    ornamentStyle: 'celestial',
    useSigils: false,
    textureId: undefined,
    textureBlendMode: 'multiply',
    textureOpacity: 0.06,
  },
  got: {
    id: 'got',
    label: 'Game of Thrones',
    // Per design reference: arcane scrollwork reads as the right
    // dark-fantasy editorial corner art for ASOIAF, not the heavy
    // gothic crucifix-style. Sigils are still used for chapter heads.
    ornamentStyle: 'arcane',
    useSigils: true,
    textureId: 'parchment',
    readerBookImage: '/citadel/book-art/Reader_Book.png',
    menuBookImage: '/citadel/book-art/Main_Book.png',
    menuBookImageSide: '/citadel/book-art/Main_Book_Side.png',
    textureBlendMode: 'multiply',
    textureOpacity: 0.08,
  },
  fantasy: {
    id: 'fantasy',
    label: 'Fantasy',
    ornamentStyle: 'arcane',
    useSigils: false,
    textureId: 'parchment',
    textureBlendMode: 'multiply',
    textureOpacity: 0.07,
  },
  darkFantasy: {
    id: 'darkFantasy',
    label: 'Dark Fantasy',
    ornamentStyle: 'gothic',
    useSigils: false,
    textureId: 'parchment',
    textureBlendMode: 'multiply',
    textureOpacity: 0.08,
  },
  scifi: {
    id: 'scifi',
    label: 'Science Fiction',
    ornamentStyle: 'scifi',
    useSigils: false,
    textureId: 'none',
    textureBlendMode: 'multiply',
    textureOpacity: 0.05,
  },
  gothic: {
    id: 'gothic',
    label: 'Gothic',
    ornamentStyle: 'gothic',
    useSigils: false,
    textureId: 'concrete',
    textureBlendMode: 'multiply',
    textureOpacity: 0.08,
  },
  mystery: {
    id: 'mystery',
    label: 'Mystery',
    ornamentStyle: 'art-deco',
    useSigils: false,
    textureId: 'none',
    textureBlendMode: 'multiply',
    textureOpacity: 0.05,
  },
  elegant: {
    id: 'elegant',
    label: 'Classic',
    ornamentStyle: 'elegant',
    useSigils: false,
    textureId: 'paper',
    textureBlendMode: 'multiply',
    textureOpacity: 0.06,
  },
};

const DEFAULT_THEME = BOOK_THEME_CONFIGS['default']!;

export function resolveBookTheme(metadata: BookMatchMetadata): BookThemeConfig {
  for (const matcher of BOOK_THEME_MATCHERS) {
    if (matcher.matches(metadata)) {
      return BOOK_THEME_CONFIGS[matcher.id] ?? DEFAULT_THEME;
    }
  }
  return DEFAULT_THEME;
}

export function resolveBookThemeFromBook(book: Book): BookThemeConfig {
  return resolveBookTheme(toBookMatchMetadata(book));
}

export function getBookTheme(themeId: string): BookThemeConfig | undefined {
  return BOOK_THEME_CONFIGS[themeId];
}

export { toBookMatchMetadata, extractSubjects };
