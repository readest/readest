import clsx from 'clsx';
import React from 'react';

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
  'data-setting-id': dataSettingId,
}) => {
  return (
    <div className={clsx('w-full', className)} data-setting-id={dataSettingId}>
      {title && (
        <h3 className='text-base-content/65 mb-2 text-[11px] font-semibold uppercase tracking-wider'>
          {title}
        </h3>
      )}
      {description && (
        <p className='text-base-content/70 -mt-1 mb-2 text-xs leading-relaxed'>{description}</p>
      )}
      <div className={clsx('card eink-bordered border-base-200 bg-base-100 border', cardClassName)}>
        <div className='divide-base-200 divide-y'>{children}</div>
      </div>
    </div>
  );
};

export default BoxedList;
