import clsx from 'clsx';
import React from 'react';

type SettingLabelProps<T extends React.ElementType = 'span'> = {
  /** Element/component to render. Defaults to `<span>`; pass `'label'` for
   *  form-field labels, `'div'` if needed. */
  as?: T;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

/**
 * Canonical primary label for a settings row / nav row / form field —
 * the per-item counterpart to `<SectionTitle>` (which labels the group).
 *
 * Sizing rules (see DESIGN.md §5):
 *  - Cased scripts (Latin / Cyrillic / Greek): adds `font-medium`.
 *    The medium weight gives the label a quiet hierarchy lift over body
 *    text without the loudness of `font-semibold`, matching Adwaita
 *    AdwActionRow titles.
 *  - Caseless scripts (CJK / Arabic / Hebrew / Indic / Thai / Tibetan):
 *    no weight class. Han / Hangul / Devanagari etc. don't bold cleanly
 *    at body size — strokes thicken unevenly and rendering varies wildly
 *    across system fonts. Plain inherited weight reads cleaner.
 *
 * No font-size is set so the label inherits the `.settings-content`
 * 14px-desktop / 16px-mobile cascade.
 */
function SettingLabel<T extends React.ElementType = 'span'>({
  as,
  children,
  className,
  ...rest
}: SettingLabelProps<T>) {
  const Tag = (as ?? 'span') as React.ElementType;
  return (
    <Tag className={clsx('text-base-content line-clamp-2', className)} {...rest}>
      {children}
    </Tag>
  );
}

export default SettingLabel;
