import { useRef } from 'react';
import BoxedList from '@/components/settings/primitives/BoxedList';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import { useTranslation } from '@/hooks/useTranslation';
import { bookshelfSchema } from '@/services/bookshelves/definitions';
import type { BookshelfDefinition } from '@/types/bookshelf';

interface BookshelfExclusivitySectionProps {
  shelf: BookshelfDefinition;
  onChange: (patch: Partial<BookshelfDefinition>) => void;
  /** Says who wins a book that several exclusive shelves match, which depends on where the shelf lives. */
  description: string;
  includeLabel: string;
  /** Whether a shelf is complete enough to save; defaults to the app's shelf schema. */
  isValid?: (shelf: BookshelfDefinition) => boolean;
}

export default function BookshelfExclusivitySection({
  shelf,
  onChange,
  description,
  includeLabel,
  isValid = (candidate) => bookshelfSchema.safeParse(candidate).success,
}: BookshelfExclusivitySectionProps) {
  const _ = useTranslation();
  const includeBeforeExclusive = useRef(new Map<string, boolean>());

  return (
    <BoxedList>
      <SettingsSwitchRow
        label={_('Exclusive')}
        description={description}
        checked={shelf.exclusive}
        disabled={
          !shelf.exclusive && !isValid({ ...shelf, exclusive: true, includeExclusiveBooks: false })
        }
        onChange={() => {
          // Exclusive shelves cannot include other exclusive shelves, so remember the
          // choice while it is forced off and restore it when Exclusive goes off again.
          if (shelf.exclusive)
            onChange({
              exclusive: false,
              includeExclusiveBooks:
                includeBeforeExclusive.current.get(shelf.id) ?? shelf.includeExclusiveBooks,
            });
          else {
            includeBeforeExclusive.current.set(shelf.id, shelf.includeExclusiveBooks);
            onChange({ exclusive: true, includeExclusiveBooks: false });
          }
        }}
      />
      <SettingsSwitchRow
        label={includeLabel}
        checked={shelf.includeExclusiveBooks}
        disabled={shelf.exclusive}
        onChange={() => onChange({ includeExclusiveBooks: !shelf.includeExclusiveBooks })}
      />
    </BoxedList>
  );
}
