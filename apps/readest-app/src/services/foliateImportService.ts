import { BookConfig, BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import { AppService } from '@/types/system';
import { mergeBookConfigs } from '@/services/backupService';
import { uniqueId } from '@/utils/misc';

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
      return { style: 'underline', color: 'yellow' };
    case 'squiggly':
      return { style: 'squiggly', color: 'yellow' };
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

/** Convert a single Foliate annotation to a BookNote. */
export function convertFoliateAnnotation(annotation: FoliateAnnotation): BookNote {
  const { style, color } = mapFoliateColor(annotation.color);
  const created = parseDate(annotation.created);
  const modified = parseDate(annotation.modified);
  return {
    id: uniqueId(),
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
export function convertFoliateBookmark(cfi: string): BookNote {
  const now = Date.now();
  return {
    id: uniqueId(),
    type: 'bookmark',
    cfi,
    note: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Convert the full Foliate data structure to a partial BookConfig. */
export function convertFoliateData(data: FoliateData): Partial<BookConfig> {
  const booknotes: BookNote[] = [];
  for (const annotation of data.annotations ?? []) {
    booknotes.push(convertFoliateAnnotation(annotation));
  }
  for (const cfi of data.bookmarks ?? []) {
    booknotes.push(convertFoliateBookmark(cfi));
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

/**
 * Import Foliate annotations for a book, merging with the current config.
 * Returns the merged config if data was imported, or the original config unchanged.
 */
export async function importFoliateData(
  appService: AppService,
  identifier: string,
  config: BookConfig,
): Promise<BookConfig> {
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

    const converted = convertFoliateData(foliateData);
    const merged = mergeBookConfigs(config, converted) as BookConfig;
    merged.foliateImportedAt = Date.now();
    return merged;
  } catch (error) {
    console.warn('Failed to import Foliate data:', error);
    return config;
  }
}
