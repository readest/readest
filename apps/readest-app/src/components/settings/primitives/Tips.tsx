import clsx from 'clsx';
import React from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';

interface TipsProps {
  /** Header label. Defaults to the translated "Tips". */
  title?: string;
  /** Bullet items — typically a list of `<li>` elements. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Quiet info callout used at the bottom of settings sub-pages to surface
 * format requirements, usage hints, etc. Subtle `bg-base-200/40` surface,
 * `MdInfoOutline` header icon, bulleted body. See the Dictionaries and
 * Custom Fonts sub-pages for canonical use.
 */
const Tips: React.FC<TipsProps> = ({ title, children, className }) => {
  const _ = useTranslation();
  return (
    <div className={clsx('bg-base-200/40 rounded-lg p-3', className)}>
      {/* `text-[0.85em]` keeps the body proportional to the inherited
          .settings-content size (≈12px desktop, ≈13.6px mobile) instead of
          locking to Tailwind's hardcoded 12px text-xs. */}
      <div className='text-base-content/70 text-[0.85em]'>
        <div className='mb-1.5 flex items-center gap-1.5 font-medium'>
          <MdInfoOutline className='h-4 w-4' />
          {title ?? _('Tips')}
        </div>
        <ul className='space-y-0.5'>
          {React.Children.map(children, (child, i) => {
            const content =
              React.isValidElement(child) &&
              (child as React.ReactElement<{ children?: React.ReactNode }>).type === 'li'
                ? (child as React.ReactElement<{ children?: React.ReactNode }>).props.children
                : child;
            return (
              <li key={i} className='flex items-start gap-2'>
                <span className='flex h-[1.4em] w-4 flex-shrink-0 items-center justify-center'>
                  <span className='bg-base-content/70 h-1.5 w-1.5 rounded-full' />
                </span>
                <span className='min-w-0 flex-1'>{content}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default Tips;
