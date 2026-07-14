import { MdChevronRight } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useImportOptions } from './importOptions';
import type { ImportOptionHandlers } from './importOptions';

interface ImportDialogProps extends ImportOptionHandlers {
  onClose: () => void;
}

export function ImportDialog({
  onClose,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
}: ImportDialogProps) {
  const _ = useTranslation();
  const options = useImportOptions({
    onImportBooksFromFiles,
    onImportBooksFromDirectory,
    onImportBookFromUrl,
    onOpenCatalogManager,
  });

  return (
    <Dialog
      isOpen={true}
      title={_('Import Books')}
      onClose={onClose}
      bgClassName={'sm:!bg-black/75'}
      boxClassName='sm:!h-auto sm:!max-h-[80vh] sm:!w-[560px] sm:!max-w-[calc(100vw-2rem)]'
      contentClassName='sm:!px-6'
    >
      <div className='grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2'>
        {options.map(({ id, label, description, Icon, onSelect }) => (
          <button
            key={id}
            type='button'
            onClick={() => {
              onClose();
              onSelect();
            }}
            className='card eink-bordered bg-base-100 border-base-200 hover:bg-base-200/40 focus-visible:ring-base-content/15 min-h-28 border p-4 text-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2'
          >
            <span className='flex items-start justify-between gap-3'>
              <span className='flex min-w-0 items-center gap-2 text-sm font-semibold'>
                <Icon aria-hidden className='h-5 w-5 flex-shrink-0' />
                <span className='truncate'>{label}</span>
              </span>
              <MdChevronRight aria-hidden className='text-base-content/40 h-5 w-5 flex-shrink-0' />
            </span>
            <span className='text-base-content/70 mt-2 text-xs leading-relaxed'>{description}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
