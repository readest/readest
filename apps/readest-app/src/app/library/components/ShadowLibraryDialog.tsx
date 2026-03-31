import { clsx } from 'clsx';
import { useEnv } from '@/context/EnvContext';
import { ShadowLibraryManager } from './ShadowLibraryManager';
import { useTranslation } from '@/hooks/useTranslation';
import Dialog from '@/components/Dialog';

interface ShadowLibraryDialogProps {
  onClose: () => void;
}

export function ShadowLibraryDialog({ onClose }: ShadowLibraryDialogProps) {
  const _ = useTranslation();
  const { appService } = useEnv();
  
  return (
    <Dialog
      isOpen={true}
      title={_('Shadow Libraries')}
      onClose={onClose}
      bgClassName={'sm:!bg-black/75'}
      boxClassName='sm:min-w-[520px] sm:w-3/4 sm:h-[85%] sm:!max-w-screen-lg'
    >
      <div className={clsx('bg-base-100 relative flex flex-col overflow-y-auto pb-4')}>
        <ShadowLibraryManager />
      </div>
    </Dialog>
  );
}
