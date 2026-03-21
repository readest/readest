import { BookConfig, BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import { mergeBookConfigs } from '@/services/backupService';
import { md5 } from 'js-md5';
import { AnnotationImportProvider } from '../types';

/** Shape of a single Foliate annotation entry. */
export interface FoliateAnnotation {
  value: string;
  text?: string;
  color?: string;
  note?: string;
  created?: string;
  modified?: string;
}

/** Shape of Foliate's per-book JSON data file. */
export interface FoliateData {
  annotations?: FoliateAnnotation[];
  bookmarks?: string[];
  progress?: [number, number];
  lastLocation?: string;
}

/** Build the absolute path to a Foliate data file for the given identifier. */
export function getFoliateDataPath(dataDir: string, identifier: string): string {
  return `${dataDir}/com.github.johnfactotum.Foliate/${encodeURIComponent(identifier)}.json`;
}

/** Map a Foliate color string to Readest highlight style and color. */
export function mapFoliateColor(color: string | undefined): {
  style: HighlightStyle;
  color: HighlightColor;
} {
  switch (color) {
    case 'yellow':
    case 'orange':
      return { style: 'highlight', color: 'yellow' };
    case 'red':
      return { style: 'highlight', color: 'red' };
    case 'magenta':
      return { style: 'highlight', color: 'violet' };
    case 'aqua':
      return { style: 'highlight', color: 'blue' };
    case 'lime':
      return { style: 'highlight', color: 'green' };
    case 'underline':
      return { style: 'underline', color: 'red' };
    case 'squiggly':
      return { style: 'squiggly', color: 'red' };
    case 'strikethrough':
      return { style: 'highlight', color: 'red' };
    case undefined:
      return { style: 'highlight', color: 'yellow' };
    default:
      // Custom hex color
      return { style: 'highlight', color };
  }
}

/** Parse an ISO 8601 date string to a timestamp, falling back to Date.now(). */
function parseDate(dateStr: string | undefined): number {
  if (!dateStr) return Date.now();
  const ts = new Date(dateStr).getTime();
  return Number.isNaN(ts) ? Date.now() : ts;
}

/** Generate a stable ID for a Foliate-imported note so re-imports deduplicate. */
function foliateNoteId(hash: string, type: string, cfi: string): string {
  return md5(`foliate:${hash}:${type}:${cfi}`).slice(0, 7);
}

/** Convert a single Foliate annotation to a BookNote. */
export function convertFoliateAnnotation(hash: string, annotation: FoliateAnnotation): BookNote {
  const { style, color } = mapFoliateColor(annotation.color);
  const created = parseDate(annotation.created);
  const modified = parseDate(annotation.modified);
  return {
    id: foliateNoteId(hash, 'annotation', annotation.value),
    type: 'annotation',
    cfi: annotation.value,
    text: annotation.text ?? '',
    style,
    color,
    note: annotation.note ?? '',
    createdAt: created,
    updatedAt: modified,
  };
}

/** Convert a Foliate bookmark CFI to a BookNote. */
export function convertFoliateBookmark(hash: string, cfi: string): BookNote {
  const now = Date.now();
  return {
    id: foliateNoteId(hash, 'bookmark', cfi),
    type: 'bookmark',
    cfi,
    note: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Convert the full Foliate data structure to a partial BookConfig. */
export function convertFoliateData(hash: string, data: FoliateData): Partial<BookConfig> {
  const booknotes: BookNote[] = [];
  for (const annotation of data.annotations ?? []) {
    booknotes.push(convertFoliateAnnotation(hash, annotation));
  }
  for (const cfi of data.bookmarks ?? []) {
    booknotes.push(convertFoliateBookmark(hash, cfi));
  }

  const result: Partial<BookConfig> = { booknotes };

  if (data.progress) {
    result.progress = data.progress;
  }
  if (data.lastLocation) {
    result.location = data.lastLocation;
  }

  return result;
}

/** Safely parse Foliate JSON data, returning null on failure. */
export function parseFoliateData(json: string): FoliateData | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as FoliateData;
  } catch {
    return null;
  }
}

export const foliateProvider: AnnotationImportProvider = {
  name: 'foliate',
  isAvailable: (appService) => appService.isLinuxApp,
  importAnnotations: async (appService, identifier, config) => {
    if (config.foliateImportedAt) return config;
    try {
      const { dataDir } = await import('@tauri-apps/api/path');
      const dir = await dataDir();
      const path = getFoliateDataPath(dir, identifier);

      if (!(await appService.exists(path, 'None'))) {
        return config;
      }

      const json = (await appService.readFile(path, 'None', 'text')) as string;
      const foliateData = parseFoliateData(json);
      if (!foliateData) {
        return config;
      }

      const converted = convertFoliateData(config.bookHash ?? '', foliateData);
      const merged = mergeBookConfigs(config, converted) as BookConfig;
      merged.foliateImportedAt = Date.now();
      return merged;
    } catch (error) {
      console.warn('Failed to import Foliate data:', error);
      return config;
    }
  },
};
