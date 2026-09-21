import type { Book } from '@/types/book';
import type { BookshelfFieldKind, BookshelfOperator } from '@/types/bookshelf';
import { stubTranslation as _ } from '@/utils/misc';

type FieldValue = string | number | boolean | string[] | undefined;
export interface BookshelfField {
  id: string;
  label: string;
  kind: BookshelfFieldKind;
  choices?: { value: string; label: string }[];
  read: (book: Book) => FieldValue;
}
const textList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(textList);
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object' && 'name' in value) return textList(value.name);
  return [];
};
const date = (value: string | undefined) =>
  value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
/** Formats whose books play through the audiobook player rather than the reader. */
const AUDIO_FORMATS = ['ABS', 'OPDSAUDIO', 'BOOKORBIT'];
// Both copies matter: a metadata edit or a synced row can leave only one of them
// (see src/utils/audiobook.ts), and reading just one misfiles podcasts as audiobooks.
const absMediaType = (b: Book) => b.absMediaType ?? b.metadata?.absMediaType;
export const BOOKSHELF_FIELDS: BookshelfField[] = [
  { id: 'title', label: _('Title'), kind: 'text', read: (b) => b.title },
  { id: 'author', label: _('Author'), kind: 'text', read: (b) => b.author },
  { id: 'subtitle', label: _('Subtitle'), kind: 'text', read: (b) => b.metadata?.subtitle },
  { id: 'publisher', label: _('Publisher'), kind: 'text', read: (b) => b.metadata?.publisher },
  { id: 'editor', label: _('Editor'), kind: 'text', read: (b) => b.metadata?.editor },
  {
    id: 'description',
    label: _('Description'),
    kind: 'text',
    read: (b) => b.metadata?.description,
  },
  { id: 'isbn', label: _('ISBN'), kind: 'text', read: (b) => b.metadata?.isbn },
  { id: 'group', label: _('Group'), kind: 'text', read: (b) => b.groupName || b.group },
  { id: 'tags', label: _('Tags'), kind: 'collection', read: (b) => b.tags },
  {
    id: 'subjects',
    label: _('Subjects'),
    kind: 'collection',
    read: (b) => textList(b.metadata?.subject),
  },
  { id: 'series', label: _('Series'), kind: 'text', read: (b) => b.metadata?.series },
  {
    id: 'seriesIndex',
    label: _('Series index'),
    kind: 'number',
    read: (b) => b.metadata?.seriesIndex,
  },
  {
    id: 'seriesTotal',
    label: _('Books in series'),
    kind: 'number',
    read: (b) => b.metadata?.seriesTotal,
  },
  {
    id: 'language',
    label: _('Language'),
    kind: 'collection',
    read: (b) => textList(b.metadata?.language || b.primaryLanguage),
  },
  { id: 'format', label: _('Format'), kind: 'text', read: (b) => b.format },
  {
    id: 'status',
    choices: [
      { value: 'unread', label: _('Unread') },
      { value: 'reading', label: _('Reading') },
      { value: 'finished', label: _('Finished') },
      { value: 'abandoned', label: _('On hold') },
    ],
    label: _('Reading status'),
    kind: 'text',
    read: (b) => b.readingStatus || (b.progress ? 'reading' : 'unread'),
  },
  {
    id: 'progress',
    label: _('Reading progress (%)'),
    kind: 'number',
    read: (b) =>
      b.progress && b.progress[1] > 0 ? (b.progress[0] / b.progress[1]) * 100 : undefined,
  },
  {
    id: 'currentlyReading',
    label: _('Currently reading'),
    kind: 'boolean',
    read: (b) =>
      b.progress != null && !['unread', 'finished', 'abandoned'].includes(b.readingStatus || ''),
  },
  { id: 'created', label: _('Date Added'), kind: 'date', read: (b) => b.createdAt },
  // Date Read deliberately retains the library's existing updatedAt semantics.
  { id: 'updated', label: _('Date Read'), kind: 'date', read: (b) => b.updatedAt },
  {
    id: 'published',
    label: _('Publication date'),
    kind: 'date',
    read: (b) => date(b.metadata?.published),
  },
  {
    id: 'narration',
    label: _('Recorded narration'),
    kind: 'boolean',
    read: (b) => !!b.hasNarration,
  },
  {
    id: 'audio',
    label: _('Audiobook'),
    kind: 'boolean',
    read: (b) => AUDIO_FORMATS.includes(b.format) && !absMediaType(b),
  },
  {
    id: 'mediaType',
    choices: [
      { value: 'ebook', label: _('Ebook') },
      { value: 'audiobook', label: _('Audiobook') },
      { value: 'podcast', label: _('Podcast') },
    ],
    label: _('Media type'),
    kind: 'text',
    read: (b) => absMediaType(b) || (AUDIO_FORMATS.includes(b.format) ? 'audiobook' : 'ebook'),
  },
  {
    id: 'availability',
    label: _('Availability'),
    kind: 'text',
    choices: [
      { value: 'local', label: _('On this device') },
      { value: 'cloud', label: _('In Readest Cloud') },
      { value: 'streaming', label: _('Streaming') },
      { value: 'unavailable', label: _('Unavailable') },
    ],
    read: (b) =>
      b.downloadedAt || b.absDownloadedAt
        ? 'local'
        : AUDIO_FORMATS.includes(b.format)
          ? 'streaming'
          : b.uploadedAt
            ? 'cloud'
            : b.filePath
              ? 'local'
              : 'unavailable',
  },
  { id: 'duration', label: _('Audio duration (seconds)'), kind: 'number', read: (b) => b.duration },
  { id: 'episodes', label: _('Episodes'), kind: 'number', read: (b) => b.episodeCount },
  {
    id: 'downloaded',
    label: _('Downloaded'),
    kind: 'boolean',
    read: (b) => !!(b.downloadedAt || b.absDownloadedAt),
  },
  { id: 'uploaded', label: _('In Readest Cloud'), kind: 'boolean', read: (b) => !!b.uploadedAt },
];
export const BOOKSHELF_OPERATORS: Record<BookshelfFieldKind, BookshelfOperator[]> = {
  text: ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'set', 'unset'],
  collection: ['contains', 'notContains', 'set', 'unset'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'set', 'unset'],
  date: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'withinLast', 'set', 'unset'],
  boolean: ['equals', 'set', 'unset'],
};
export const BOOKSHELF_OPERATOR_LABELS: Record<BookshelfOperator, string> = {
  contains: _('Contains'),
  notContains: _('Does not contain'),
  equals: _('Is'),
  notEquals: _('Is not'),
  startsWith: _('Starts with'),
  gt: _('Greater than / after'),
  gte: _('At least / on or after'),
  lt: _('Less than / before'),
  lte: _('At most / on or before'),
  withinLast: _('Within the last'),
  set: _('Is set'),
  unset: _('Is not set'),
};
export const calibreFieldKind = (datatype: string, value?: unknown): BookshelfFieldKind => {
  if (Array.isArray(value)) return 'collection';
  if (['int', 'float', 'rating'].includes(datatype)) return 'number';
  if (datatype === 'bool') return 'boolean';
  if (datatype === 'datetime') return 'date';
  return 'text';
};
export const getBookshelfField = (
  id: string,
  kind?: BookshelfFieldKind,
): BookshelfField | undefined => {
  const known = BOOKSHELF_FIELDS.find((field) => field.id === id);
  if (known) return known;
  if (!id.startsWith('calibre:') || id.length <= 8 || !kind) return undefined;
  return {
    id,
    label: id.slice(8),
    kind,
    read: (book) => {
      const column = book.metadata?.calibreColumns?.find((c) => c.label === id.slice(8));
      if (!column || calibreFieldKind(column.datatype, column.value) !== kind) return undefined;
      return kind === 'date' ? date(String(column.value)) : column.value;
    },
  };
};
export const discoverBookshelfFields = (books: Book[]): BookshelfField[] => {
  const fields = new Map(BOOKSHELF_FIELDS.map((field) => [field.id, field]));
  for (const book of books)
    for (const column of book.metadata?.calibreColumns || []) {
      const field = getBookshelfField(
        `calibre:${column.label}`,
        calibreFieldKind(column.datatype, column.value),
      )!;
      fields.set(field.id, { ...field, label: column.name });
    }
  return [...fields.values()];
};

export const bookshelfFieldOperators = (
  id: string,
  kind: BookshelfFieldKind,
): BookshelfOperator[] =>
  getBookshelfField(id, kind)?.choices
    ? ['equals', 'notEquals', 'set', 'unset']
    : BOOKSHELF_OPERATORS[kind];
