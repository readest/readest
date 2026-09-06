import { clsx } from 'clsx';
import { useEnv } from '@/context/EnvContext';
import { CatalogManager, CATALOG_DIALOG_BOX_CLASS } from '@/app/opds/components/CatalogManager';
import { useTranslation } from '@/hooks/useTranslation';
import Dialog from '@/components/Dialog';

interface CatalogDialogProps {
  onClose: () => void;
}

export function CatalogDialog({ onClose }: CatalogDialogProps) {
  const _ = useTranslation();
  const { appService } = useEnv();
  return (
    <Dialog
      isOpen={true}
      title={appService?.isOnlineCatalogsAccessible ? _('Online Library') : _('OPDS Catalogs')}
      onClose={onClose}
      bgClassName={'sm:bg-black/75!'}
      boxClassName={CATALOG_DIALOG_BOX_CLASS}
    >
      <div className={clsx('bg-base-100 relative flex flex-col overflow-y-auto pb-4')}>
        <CatalogManager />
      </div>
    </Dialog>
  );
}
