import clsx from 'clsx';
import React from 'react';
import { isCaselessUILang } from '@/utils/misc';

type SectionTitleProps<T extends React.ElementType = 'h3'> = {
  /** Element/component to render. Defaults to `<h3>` for section dividers;
   *  pass `'label'` for form-field titles, `'div'`/`'span'` if no semantic
   *  heading is wanted. */
  as?: T;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

/**
 * Canonical small-uppercase section title used across settings panels —
 * Theme Color, Background Image, Reading Sync, Content Sources, BoxedList
 * group titles, and integration form field labels (Server URL, Username,
 * etc.).
 *
 * Sizing rules (see DESIGN.md §5):
 *  - Latin / Cyrillic / Greek (cased scripts): `text-[0.85em]`. Casing
 *    plus tracking carries the visual emphasis.
 *  - Caseless scripts (CJK / Arabic / Hebrew / Indic / Thai / Tibetan):
 *    `text-[1em]`. `uppercase` is a no-op on Han/Hangul/Devanagari etc.,
 *    so the size has to do the work the casing can't.
 *
 * No margin is baked in — callers control spacing via `className` (typical
 * values: `mb-2` for top-of-section, no margin when the parent uses
 * `space-y-*`).
 */
function SectionTitle<T extends React.ElementType = 'h3'>({
  as,
  children,
  className,
  ...rest
}: SectionTitleProps<T>) {
  const Tag = (as ?? 'h3') as React.ElementType;
  return (
    <Tag
      className={clsx(
        'ps-4',
        isCaselessUILang()
          ? 'text-base-content/65 text-[0.8em] font-medium'
          : 'text-base-content/65 text-[0.8em] font-medium',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export default SectionTitle;
