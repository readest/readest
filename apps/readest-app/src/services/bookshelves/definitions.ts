import { z } from 'zod';
import type {
  BookshelfDefinition,
  BookshelfFilterGroup,
  BookshelfLayout,
  BookshelfRule,
} from '@/types/bookshelf';
import { LibrarySortByType, LibraryGroupByType, type SystemSettings } from '@/types/settings';
import { bookshelfFieldOperators, getBookshelfField } from './fields';
import { stubTranslation as _ } from '@/utils/misc';

export const DEFAULT_BOOKSHELF_ID = 'default';
export const RECENT_BOOKSHELF_ID = 'recent';
export const AUDIOBOOKS_BOOKSHELF_ID = 'audiobooks';
export const PODCASTS_BOOKSHELF_ID = 'podcasts';
export const FINISHED_BOOKSHELF_ID = 'finished';
export const BUILTIN_BOOKSHELF_IDS = [
  'recent',
  'audiobooks',
  'podcasts',
  'default',
  'finished',
] as const;
// Positions are persisted independently of definitions. Insert new presets into gaps;
// never renumber existing positions when adding a predefined shelf.
export const BUILTIN_BOOKSHELF_POSITIONS: Readonly<Record<string, number>> = {
  recent: 0,
  audiobooks: 256,
  podcasts: 512,
  default: 1024,
  finished: 2048,
};
export const bookshelfIdSchema = z.union([z.enum(BUILTIN_BOOKSHELF_IDS), z.uuid()]);
export const isBuiltinBookshelf = (id: string) =>
  BUILTIN_BOOKSHELF_IDS.some((builtinId) => builtinId === id);
export const bookshelfName = (shelf: BookshelfDefinition) =>
  shelf.name ||
  (shelf.id === RECENT_BOOKSHELF_ID
    ? _('Recently read')
    : shelf.id === AUDIOBOOKS_BOOKSHELF_ID
      ? _('Audiobooks')
      : shelf.id === PODCASTS_BOOKSHELF_ID
        ? _('Podcasts')
        : shelf.id === FINISHED_BOOKSHELF_ID
          ? _('Finished books')
          : _('Default'));
// Keep existing serialized layouts compatible; only Carousel is a per-shelf choice.
export const resolveBookshelfLayout = (
  shelf: BookshelfDefinition,
  viewMode: string | undefined | null,
): BookshelfLayout =>
  shelf.layout === 'carousel' ? 'carousel' : viewMode === 'list' ? 'list' : 'grid';
export const BOOKSHELF_SORT_LABELS: Record<LibrarySortByType, string> = {
  title: _('Title'),
  author: _('Author'),
  updated: _('Date Read'),
  created: _('Date Added'),
  series: _('Series'),
  size: _('Size'),
  format: _('Format'),
  published: _('Date Published'),
  progress: _('Progress Read'),
  timeRemaining: _('Time Remaining'),
};
export const BOOKSHELF_GROUP_LABELS: Record<LibraryGroupByType, string> = {
  author: _('Authors'),
  none: _('Books'),
  group: _('Groups'),
  series: _('Series'),
  tag: _('Tags'),
  subject: _('Subjects'),
  status: _('Status'),
};
const ruleSchema: z.ZodType<BookshelfRule> = z
  .object({
    type: z.literal('rule'),
    field: z.string().min(1).max(200),
    kind: z.enum(['text', 'collection', 'number', 'date', 'boolean']),
    operator: z.enum([
      'contains',
      'notContains',
      'equals',
      'notEquals',
      'startsWith',
      'gt',
      'gte',
      'lt',
      'lte',
      'withinLast',
      'set',
      'unset',
    ]),
    value: z.union([z.string().max(4000), z.number().finite(), z.boolean()]).optional(),
    unit: z.enum(['days', 'months', 'years']).optional(),
  })
  .strict()
  .refine(
    (rule) => {
      const field = getBookshelfField(rule.field, rule.kind);
      if (
        !field ||
        field.kind !== rule.kind ||
        !bookshelfFieldOperators(rule.field, rule.kind).includes(rule.operator)
      )
        return false;
      if (rule.operator === 'withinLast')
        return (
          rule.kind === 'date' &&
          !!rule.unit &&
          typeof rule.value === 'number' &&
          Number.isSafeInteger(rule.value) &&
          rule.value > 0
        );
      if (rule.unit !== undefined) return false;
      if (rule.operator === 'set' || rule.operator === 'unset') return true;
      if (rule.kind === 'number') return typeof rule.value === 'number';
      if (rule.kind === 'boolean') return typeof rule.value === 'boolean';
      if (rule.kind === 'date')
        return (
          typeof rule.value === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(rule.value) &&
          Number.isFinite(Date.parse(rule.value))
        );
      return typeof rule.value === 'string' && rule.value.trim().length > 0;
    },
    { message: _('Complete every filter condition.') },
  );
// Bound recursion before descending, including at untrusted sync/backup boundaries.
const groupSchema = (depth: number): z.ZodType<BookshelfFilterGroup> =>
  z
    .object({
      type: z.literal('group'),
      match: z.enum(['all', 'any']),
      children: z
        .array(depth < 6 ? z.union([ruleSchema, z.lazy(() => groupSchema(depth + 1))]) : ruleSchema)
        .min(depth ? 1 : 0, { message: _('Complete every filter condition.') })
        .max(50),
    })
    .strict();
export const bookshelfSchema: z.ZodType<BookshelfDefinition> = z
  .object({
    id: bookshelfIdSchema,
    name: z.string().max(120),
    enabled: z.boolean(),
    layout: z.enum(['carousel', 'grid', 'list']),
    hideCovers: z.boolean().optional(),
    coverFit: z.enum(['crop', 'fit']).optional(),
    skeuomorphicCovers: z.boolean().optional(),
    filters: groupSchema(0),
    useGlobalGrouping: z.boolean().optional(),
    groupBy: z.enum(Object.values(LibraryGroupByType)).optional(),
    useGlobalSort: z.boolean().optional(),
    sort: z
      .object({
        by: z.enum(Object.values(LibrarySortByType)),
        ascending: z.boolean(),
        thenBy: z.enum([...Object.values(LibrarySortByType), 'none']),
        thenAscending: z.boolean(),
      })
      .strict(),
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    exclusive: z.boolean(),
    includeExclusiveBooks: z.boolean(),
  })
  .strict()
  .refine((s) => isBuiltinBookshelf(s.id) || !!s.name.trim(), {
    message: _('Enter a bookshelf name.'),
  })
  .refine((s) => !s.exclusive || (s.filters.children.length > 0 && !s.includeExclusiveBooks), {
    message: _(
      'Exclusive shelves need a complete filter and cannot include other exclusive shelves.',
    ),
  })
  // Stay under the replica row's 64 KiB `fields_jsonb` cap with room for the
  // position field and envelope stamps, or the server rejects the row forever.
  .refine((s) => new TextEncoder().encode(JSON.stringify(s)).length <= 60000, {
    message: _('This bookshelf has too many or too long filter conditions.'),
  });
export const createBookshelf = (name: string, id = crypto.randomUUID()): BookshelfDefinition => ({
  id,
  name,
  enabled: true,
  layout: 'carousel',
  hideCovers: false,
  coverFit: 'crop',
  skeuomorphicCovers: false,
  filters: { type: 'group', match: 'all', children: [] },
  useGlobalGrouping: true,
  groupBy: 'group',
  useGlobalSort: true,
  sort: { by: 'updated', ascending: false, thenBy: 'none', thenAscending: true },
  exclusive: false,
  includeExclusiveBooks: false,
});
export const defaultBookshelves = (settings: Partial<SystemSettings>): BookshelfDefinition[] => [
  {
    ...createBookshelf('', RECENT_BOOKSHELF_ID),
    skeuomorphicCovers: settings.librarySkeuomorphicCovers ?? false,
    includeExclusiveBooks: true,
    coverFit: settings.libraryCoverFit || 'crop',
    hideCovers: settings.libraryHideCovers ?? false,
    enabled: settings.libraryRecentShelfEnabled ?? true,
    filters: {
      type: 'group',
      match: 'all',
      children: [
        {
          type: 'rule',
          field: 'currentlyReading',
          kind: 'boolean',
          operator: 'equals',
          value: true,
        },
      ],
    },
    sort: { by: 'updated', ascending: false, thenBy: 'none', thenAscending: true },
  },
  {
    ...createBookshelf('', AUDIOBOOKS_BOOKSHELF_ID),
    skeuomorphicCovers: settings.librarySkeuomorphicCovers ?? false,
    exclusive: true,
    filters: {
      type: 'group',
      match: 'all',
      children: [
        { type: 'rule', field: 'audio', kind: 'boolean', operator: 'equals', value: true },
      ],
    },
  },
  {
    ...createBookshelf('', PODCASTS_BOOKSHELF_ID),
    skeuomorphicCovers: settings.librarySkeuomorphicCovers ?? false,
    exclusive: true,
    filters: {
      type: 'group',
      match: 'all',
      children: [
        { type: 'rule', field: 'mediaType', kind: 'text', operator: 'equals', value: 'podcast' },
      ],
    },
  },
  {
    ...createBookshelf('', DEFAULT_BOOKSHELF_ID),
    skeuomorphicCovers: settings.librarySkeuomorphicCovers ?? false,
    coverFit: settings.libraryCoverFit || 'crop',
    hideCovers: settings.libraryHideCovers ?? false,
    layout: settings.libraryViewMode || 'grid',
    sort: {
      by:
        (settings.librarySortByAuto ?? true) && settings.libraryGroupBy === 'series'
          ? 'series'
          : settings.librarySortBy || 'updated',
      ascending: settings.librarySortAscending ?? false,
      thenBy:
        (!settings.libraryThenSortBy || settings.libraryThenSortBy === 'none') &&
        settings.libraryGroupBy === 'author'
          ? 'series'
          : settings.libraryThenSortBy || 'none',
      thenAscending: settings.libraryThenSortAscending ?? true,
    },
  },
  {
    ...createBookshelf('', FINISHED_BOOKSHELF_ID),
    skeuomorphicCovers: settings.librarySkeuomorphicCovers ?? false,
    coverFit: settings.libraryCoverFit || 'crop',
    enabled: false,
    hideCovers: settings.libraryHideCovers ?? false,
    filters: {
      type: 'group',
      match: 'all',
      children: [
        { type: 'rule', field: 'status', kind: 'text', operator: 'equals', value: 'finished' },
      ],
    },
    sort: { by: 'updated', ascending: false, thenBy: 'none', thenAscending: true },
  },
];
export const effectiveBookshelves = (shelves: BookshelfDefinition[]) =>
  shelves.some((s) => s.enabled)
    ? shelves
    : shelves.map((s) => (s.id === DEFAULT_BOOKSHELF_ID ? { ...s, enabled: true } : s));
