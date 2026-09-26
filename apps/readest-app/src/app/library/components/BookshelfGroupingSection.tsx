import type { ReactNode } from 'react';
import SettingsRow from '@/components/settings/primitives/SettingsRow';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import { useTranslation } from '@/hooks/useTranslation';
import { BOOKSHELF_GROUP_LABELS } from '@/services/bookshelves/definitions';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { LibraryGroupByType } from '@/types/settings';

interface BookshelfGroupingSectionProps {
  shelf: BookshelfDefinition;
  onChange: (patch: Partial<BookshelfDefinition>) => void;
  /** Passing the global grouping offers "Use global grouping"; omit it for a shelf that always groups by its own axis. */
  globalGroupBy?: LibraryGroupByType;
  /** Extra rows shown after "Group by", for settings that only make sense alongside it. */
  children?: ReactNode;
}

export default function BookshelfGroupingSection({
  shelf,
  onChange,
  globalGroupBy,
  children,
}: BookshelfGroupingSectionProps) {
  const _ = useTranslation();
  const useGlobal = globalGroupBy !== undefined && shelf.useGlobalGrouping !== false;
  const groupBy = useGlobal ? globalGroupBy : shelf.groupBy || 'group';

  return (
    <fieldset className='eink-bordered border-base-200 min-w-0 rounded-lg border ps-4'>
      <legend className='-ms-1 px-1 text-sm'>{_('Grouping')}</legend>
      <div className='divide-base-200 divide-y'>
        {globalGroupBy !== undefined && (
          <SettingsSwitchRow
            label={_('Use global grouping')}
            checked={useGlobal}
            onChange={() => onChange({ useGlobalGrouping: !useGlobal })}
          />
        )}
        <SettingsRow label={_('Group by')} disabled={useGlobal}>
          <SettingsSelect
            ariaLabel={_('Group by')}
            value={groupBy}
            disabled={useGlobal}
            options={Object.entries(BOOKSHELF_GROUP_LABELS).map(([value, label]) => ({
              value,
              label: _(label),
            }))}
            onChange={(e) =>
              onChange({ groupBy: e.target.value as BookshelfDefinition['groupBy'] })
            }
          />
        </SettingsRow>
        {children}
      </div>
    </fieldset>
  );
}
