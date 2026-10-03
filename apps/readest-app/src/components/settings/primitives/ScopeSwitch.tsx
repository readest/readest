import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { ThemeScope } from '@/styles/themes';

interface ScopeSwitchProps {
  /** Names the pair for screen readers, e.g. 'Background Image' or 'Theme'. */
  label: string;
  scope: ThemeScope;
  onScopeChange: (scope: ThemeScope) => void;
}

/**
 * The `Library | Reader` segmented control that marks a setting as having a
 * separate value per page — background image (#5306) and theme (#5945).
 *
 * Same anatomy as ThemeModeSelector (44px targets, eink-bordered track +
 * eink-inverted active thumb) but with text labels: the visible pair is what
 * tells users the two pages can differ at all.
 */
const ScopeSwitch: React.FC<ScopeSwitchProps> = ({ label, scope, onScopeChange }) => {
  const _ = useTranslation();

  return (
    <div
      role='radiogroup'
      aria-label={label}
      className='bg-base-200 eink-bordered inline-flex items-center rounded-full p-0.5'
    >
      {(
        [
          { scope: 'library', label: _('Library') },
          { scope: 'reader', label: _('Reader') },
        ] as const
      ).map(({ scope: segScope, label: segLabel }) => {
        const active = scope === segScope;
        return (
          <button
            key={segScope}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => onScopeChange(segScope)}
            className={clsx(
              // em-based like SectionTitle, not rem-based text-sm — the
              // settings-content wrapper scales 14/16px (DESIGN.md §5).
              'flex h-9 items-center justify-center rounded-full px-3 text-[0.85em] font-medium transition-colors',
              'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
              active
                ? 'bg-base-300 text-base-content eink-inverted shadow-xs'
                : 'text-base-content/60 hover:text-base-content',
            )}
          >
            {segLabel}
          </button>
        );
      })}
    </div>
  );
};

export default ScopeSwitch;
