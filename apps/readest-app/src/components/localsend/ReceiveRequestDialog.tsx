import React, { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { partitionSupportedFiles } from '@/services/localsend/formats';
import { previewDataUrl } from '@/services/localsend/preview';
import type { ReceiveRequest } from '@/services/localsend/types';
import { formatBytes } from '@/utils/book';
import Alert from '@/components/Alert';
import clsx from 'clsx';

const MAX_LISTED_FILES = 8;

interface ReceiveRequestDialogProps {
  request: ReceiveRequest;
  onAccept: (fileIds: string[]) => void;
  onDecline: () => void;
}

/**
 * Incoming LocalSend transfer prompt. Lists only the book files Readest can
 * import; other offered files are declined via protocol partial-accept, with
 * a note so the user knows the sender sees the split.
 */
const ReceiveRequestDialog: React.FC<ReceiveRequestDialogProps> = ({
  request,
  onAccept,
  onDecline,
}) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const { supported, skipped } = useMemo(
    () => partitionSupportedFiles(request.files),
    [request.files],
  );

  const totalSize = supported.reduce((sum, file) => sum + file.size, 0);

  return (
    <div
      className={clsx(
        // z-[60]: must stack above the device picker (z-50), or an incoming
        // request hides under an open picker sheet and can never be answered.
        'localsend-receive-alert fixed bottom-0 left-0 right-0 z-[60] flex justify-center',
      )}
      style={{ paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px` }}
    >
      <Alert
        title={_('{{alias}} wants to send you books', { alias: request.sender.alias })}
        message={_('{{count}} book(s), {{size}}', {
          count: supported.length,
          size: formatBytes(totalSize),
        })}
        confirmLabel={_('Accept')}
        confirmButtonClassName='btn-contrast'
        onCancel={onDecline}
        onConfirm={() => onAccept(supported.map((file) => file.id))}
      >
        <div className='flex flex-col gap-1 ps-9 text-sm'>
          {supported.slice(0, MAX_LISTED_FILES).map((file) => {
            const cover = previewDataUrl(file.preview);
            return (
              <div key={file.id} className='flex min-w-0 items-center justify-between gap-3'>
                <span className='flex min-w-0 items-center gap-2'>
                  {cover && (
                    <img
                      src={cover}
                      alt=''
                      className='eink-bordered h-10 w-7 shrink-0 rounded-sm object-cover'
                    />
                  )}
                  <span className='truncate'>{file.fileName}</span>
                </span>
                <span className='text-base-content/60 shrink-0 text-xs'>
                  {formatBytes(file.size)}
                </span>
              </div>
            );
          })}
          {supported.length > MAX_LISTED_FILES && (
            <div className='text-base-content/60 text-xs'>
              {_('and {{count}} more', { count: supported.length - MAX_LISTED_FILES })}
            </div>
          )}
          {skipped.length > 0 && (
            <div className='text-base-content/60 text-xs'>
              {_('{{count}} unsupported file(s) will be skipped', { count: skipped.length })}
            </div>
          )}
        </div>
      </Alert>
    </div>
  );
};

export default ReceiveRequestDialog;
