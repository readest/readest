import SettingsRow from '@/components/settings/primitives/SettingsRow';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import { useTranslation } from '@/hooks/useTranslation';
import { BOOKSHELF_SORT_LABELS } from '@/services/bookshelves/definitions';
import type { BookshelfDefinition, BookshelfSort } from '@/types/bookshelf';

interface BookshelfSortingSectionProps {
  shelf: BookshelfDefinition;
  onChange: (patch: Partial<BookshelfDefinition>) => void;
  /** Passing the global sort offers "Use global sorting"; omit it for a shelf that always uses its own sort. */
  globalSort?: BookshelfSort;
}

export default function BookshelfSortingSection({
  shelf,
  onChange,
  globalSort,
}: BookshelfSortingSectionProps) {
  const _ = useTranslation();
  const useGlobal = globalSort !== undefined && shelf.useGlobalSort !== false;
  const selectedSort = useGlobal ? globalSort : shelf.sort;
  const sort = (patch: Partial<BookshelfSort>) => onChange({ sort: { ...shelf.sort, ...patch } });
  const sortOptions = Object.entries(BOOKSHELF_SORT_LABELS)
    .filter(([value]) => value !== 'size')
    .map(([value, label]) => ({ value, label: _(label) }));

  return (
    <fieldset className='eink-bordered border-base-200 min-w-0 rounded-lg border ps-4'>
      <legend className='-ms-1 px-1 text-sm'>{_('Sorting')}</legend>
      <div className='divide-base-200 divide-y'>
        {globalSort !== undefined && (
          <SettingsSwitchRow
            label={_('Use global sorting')}
            checked={useGlobal}
            onChange={() => onChange({ useGlobalSort: !useGlobal })}
          />
        )}
        <SettingsRow label={_('Sort by')} disabled={useGlobal}>
          <SettingsSelect
            ariaLabel={_('Sort by')}
            disabled={useGlobal}
            value={selectedSort.by}
            options={sortOptions}
            onChange={(e) => sort({ by: e.target.value as BookshelfSort['by'] })}
          />
        </SettingsRow>
        <SettingsSwitchRow
          label={_('Ascending')}
          disabled={useGlobal}
          checked={selectedSort.ascending}
          onChange={() => sort({ ascending: !shelf.sort.ascending })}
        />
        <SettingsRow label={_('Then by')} disabled={useGlobal}>
          <SettingsSelect
            ariaLabel={_('Then by')}
            disabled={useGlobal}
            value={selectedSort.thenBy}
            options={[{ value: 'none', label: _('None') }, ...sortOptions]}
            onChange={(e) => sort({ thenBy: e.target.value as BookshelfSort['thenBy'] })}
          />
        </SettingsRow>
        <SettingsSwitchRow
          label={_('Secondary sort ascending')}
          disabled={useGlobal || selectedSort.thenBy === 'none'}
          checked={selectedSort.thenAscending}
          onChange={() => sort({ thenAscending: !shelf.sort.thenAscending })}
        />
      </div>
    </fieldset>
  );
}
