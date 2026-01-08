import { clsx } from 'clsx';
import { CatalogManager } from '@/app/opds/components/CatelogManager';
import { useTranslation } from '@/hooks/useTranslation';
import Dialog from '@/components/Dialog';

interface CatalogDialogProps {
  onClose: () => void;
}

export function CatalogDialog({ onClose }: CatalogDialogProps) {
  const _ = useTranslation();
  return (
    <Dialog
      isOpen={true}
      title={_('Online Library')}
      onClose={onClose}
      bgClassName={'sm:!bg-black/75'}
      boxClassName='sm:min-w-[520px] sm:w-3/4 sm:h-[85%] sm:!max-w-screen-sm'
    >
      <div className={clsx('bg-base-100 relative flex flex-col overflow-y-auto pb-4')}>
        <CatalogManager />
      </div>
    </Dialog>
  );
}
