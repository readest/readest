import clsx from 'clsx';
import React from 'react';
import { MdChevronRight } from 'react-icons/md';

interface SubPageHeaderProps {
  /** Label of the parent panel (the "back" target). */
  parentLabel: string;
  /** Label of the current sub-page. */
  currentLabel: string;
  /**
   * One-line explanation of what this sub-page does. Required by DESIGN.md §2.8
   * for every sub-page; skip only when the breadcrumb already says everything.
   * Accepts ReactNode so callers can embed `<a>` links etc.
   */
  description?: React.ReactNode;
  /** Click handler for the parent breadcrumb (returns to list view). */
  onBack: () => void;
  /** Optional trailing content (e.g. Edit / Delete toggles). */
  rightSlot?: React.ReactNode;
}

/**
 * Settings sub-page header. Canonical shape for any sub-page that pushes off a
 * parent panel's boxed list — Dictionaries, Integrations sub-pages, future
 * Reading Statistics drill-downs, etc. See DESIGN.md §2.8 / §5 / §6.
 *
 * The parent label uses the same `text-lg font-semibold tracking-tight` as the
 * parent panel's h2 so the word stays in place visually as the user navigates
 * in/out — the only change is a chevron + current page appearing alongside (a
 * "navigation morph" rather than a layout shift).
 *
 * The description renders below the breadcrumb row, inheriting the
 * `.settings-content` body size (14px desktop / 16px mobile).
 */
const SubPageHeader: React.FC<SubPageHeaderProps> = ({
  parentLabel,
  currentLabel,
  description,
  onBack,
  rightSlot,
}) => {
  return (
    <div className={clsx(description ? 'mb-6' : 'mb-4', 'px-4')}>
      <div className='mb-1.5 flex w-full items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight'>
          <button
            type='button'
            onClick={onBack}
            className='hover:text-primary transition-colors duration-150 focus-visible:underline focus-visible:outline-none'
          >
            {parentLabel}
          </button>
          <MdChevronRight
            aria-hidden='true'
            className='text-base-content/40 h-5 w-5 flex-shrink-0'
          />
          <span className='text-base-content/70 truncate'>{currentLabel}</span>
        </div>
        {rightSlot}
      </div>
      {/* No explicit text-sm — description inherits .settings-content
          font-size (14px desktop / 16px mobile per src/styles/globals.css). */}
      {description && <p className='text-base-content/70 leading-relaxed'>{description}</p>}
    </div>
  );
};

export default SubPageHeader;
