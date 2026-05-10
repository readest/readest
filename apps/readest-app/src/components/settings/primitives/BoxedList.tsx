import clsx from 'clsx';
import React from 'react';
import SectionTitle from './SectionTitle';

interface BoxedListProps {
  /**
   * Optional small-uppercase label above the boxed list (Adwaita
   * AdwPreferencesGroup style). Style is fixed: caller passes the string.
   */
  title?: string;
  /**
   * Optional one-line description rendered between the title and the list.
   * Use sparingly — most groups need just the label.
   */
  description?: React.ReactNode;
  /** Child rows — typically `<SettingsRow>` / `<SettingsSwitchRow>` / `<NavigationRow>`. */
  children: React.ReactNode;
  /** Outer wrapper className (spacing, data-setting-id ancestor, etc.). */
  className?: string;
  /** Inner card className (borders, bg, etc.). */
  cardClassName?: string;
  /** Inner wrapper className (padding, etc.). */
  innerClassName?: string;
  /** Forwarded to the outer wrapper for command-palette deep-linking. */
  'data-setting-id'?: string;
}

/**
 * Adwaita-style `AdwPreferencesGroup` container. Renders an optional small
 * uppercase title + description, then the boxed-list card with `divide-y`
 * rows inside. See DESIGN.md §5.
 */
const BoxedList: React.FC<BoxedListProps> = ({
  title,
  description,
  children,
  className,
  cardClassName,
  innerClassName,
  'data-setting-id': dataSettingId,
}) => {
  return (
    <div className={clsx('w-full', className)} data-setting-id={dataSettingId}>
      {title && <SectionTitle className='mb-2'>{title}</SectionTitle>}
      {description && (
        <p className='text-base-content/65 -mt-1 mb-2 text-[0.7em] leading-relaxed'>
          {description}
        </p>
      )}
      <div className={clsx('card eink-bordered border-base-200 bg-base-100 border', cardClassName)}>
        <div className={clsx('divide-base-200 divide-y ps-4', innerClassName)}>{children}</div>
      </div>
    </div>
  );
};

export default BoxedList;
