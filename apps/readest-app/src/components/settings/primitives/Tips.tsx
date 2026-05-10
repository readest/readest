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
      <div className='text-base-content/70 text-xs'>
        <div className='mb-1.5 flex items-center gap-1.5 font-medium'>
          <MdInfoOutline className='h-3.5 w-3.5' />
          {title ?? _('Tips')}
        </div>
        <ul className='list-outside list-disc space-y-0.5 ps-4'>{children}</ul>
      </div>
    </div>
  );
};

export default Tips;
