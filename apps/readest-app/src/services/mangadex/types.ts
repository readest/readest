export const BASE_URL = new URL('https://api.mangadex.org');

export type LocalizedString = Record<string, string>;
export type MangaRelation =
  | 'monochrome'
  | 'colored'
  | 'adapted_from'
  | 'based_on'
  | 'prequel'
  | 'sequel'
  | 'main_story'
  | 'side_story'
  | 'spin_off'
  | 'doujinshi'
  | 'same_franchise'
  | 'shared_universe'
  | 'alternate_story'
  | 'alternate_version';
export type Relationship =
  | {
      id: string;
      type: 'author' | 'artist' | 'cover_art' | 'chapter' | 'scanlation_group' | 'user' | 'creator';
      attributes?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'manga';
      related: MangaRelation;
      attributes?: Record<string, unknown>;
    };

export interface Tag {
  id: string;
  name: Record<string, string>;
  group: string; // TODO: Convert to union
}

export interface MangaAttributes {
  title: Record<string, string>;
  altTitles: Record<string, string>[];
  description: Record<string, string>;
  isLocked: boolean;
  links?: Record<string, string>;
  originalLanguage: string;
  lastVolume: string | null;
  lastChapter: string | null;
  publicationDemographic: string | null;
  status: string;
  year: number | null;
  contentRating: string;
  tags: Tag[];
  state: string;
  chapterNumbersResetOnNewVolume: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  availableTranslatedLanguages: string[];
  latestUploadedChapter: string | null;
}

export interface Manga {
  id: string;
  attributes: MangaAttributes;
  relationships: Relationship[];
}
