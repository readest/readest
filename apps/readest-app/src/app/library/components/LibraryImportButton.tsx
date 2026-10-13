import { useTranslation } from '@/hooks/useTranslation';
import clsx from 'clsx';
import { MdAdd } from 'react-icons/md';

export default function LibraryImportButton({
  onImport,
  primary = false,
}: {
  onImport: (anchor: HTMLElement) => void;
  primary?: boolean;
}) {
  const _ = useTranslation();
  return (
    <button
      type='button'
      aria-label={_('Import Books')}
      aria-haspopup='menu'
      className={clsx(
        'w-full max-w-xs',
        primary
          ? 'btn btn-primary h-11 min-h-11 rounded-lg'
          : [
              'bg-base-100 eink-bordered group flex h-12 min-h-12 items-center justify-center gap-2 rounded-2xl',
              'border-base-200 hover:border-base-300 hover:bg-base-300/40 border',
              'text-base-content text-sm font-medium transition-colors duration-150',
              'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
            ],
      )}
      onClick={(event) => onImport(event.currentTarget)}
    >
      {!primary && (
        <span
          aria-hidden
          className='eink-inverted bg-base-200 text-base-content/60 group-hover:bg-base-content group-hover:text-base-100 flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-150'
        >
          <MdAdd className='size-3.5' />
        </span>
      )}
      <span className='line-clamp-1'>{_('Import Books')}</span>
    </button>
  );
}
