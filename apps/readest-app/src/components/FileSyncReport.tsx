import { cloudProviderDisplayName } from '@/services/sync/cloudSyncProvider';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSyncStore } from '@/store/fileSyncStore';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/** Survives navigation and never disappears on a toast timer. */
export default function FileSyncReport() {
  const _ = useTranslation();
  const reports = useFileSyncStore((s) => s.reportByKind);
  const dismiss = useFileSyncStore((s) => s.dismissReport);
  const kind = (Object.keys(reports) as FileSyncBackendKind[]).find((key) => reports[key]);
  const close = () => {
    if (kind) dismiss(kind);
  };
  return (
    <Dialog
      key={kind}
      id='file-sync-report'
      className='z-[120]!'
      boxClassName='sm:h-auto! sm:max-h-[80%]!'
      snapHeight={0.6}
      isOpen={!!kind}
      title={kind ? `${cloudProviderDisplayName(kind)}: ${_('Sync failed')}` : _('Sync failed')}
      onClose={close}
    >
      <div className='flex flex-col gap-4 p-4'>
        <p className='whitespace-pre-wrap break-words text-sm'>{kind && reports[kind]}</p>
        <button type='button' className='btn btn-contrast self-end' onClick={close}>
          {_('Dismiss')}
        </button>
      </div>
    </Dialog>
  );
}
