import clsx from 'clsx';
import {
  MdDelete,
  MdOpenInNew,
  MdOutlineCancel,
  MdInfoOutline,
  MdCheckCircleOutline,
} from 'react-icons/md';
import { IoShareSocialOutline } from 'react-icons/io5';
import { LuFolderPlus } from 'react-icons/lu';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { isMd5 } from '@/utils/md5';

interface SelectModeActionsProps {
  selectedBooks: string[];
  safeAreaBottom: number;
  // When false (Linux desktop, Windows desktop, web) the Send button is
  // hidden entirely — those platforms can't surface a system share sheet
  // so the affordance would be misleading. Note: this is *file send* (hands
  // the book file to the OS share sheet), distinct from "Share Book" in
  // the per-item context menu, which generates a remote share link.
  sendEnabled?: boolean;
  onOpen: () => void;
  onGroup: () => void;
  onDetails: () => void;
  onStatus: () => void;
  // The macOS / iPad share popover is anchored to the selected book's
  // cover (located via its data-book-hash attribute), not to this
  // button — the user's visual focus is on the cover they just tapped.
  // On iOS / Android the share sheet is modal and ignores position.
  onSend: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

const SelectModeActions: React.FC<SelectModeActionsProps> = ({
  selectedBooks,
  safeAreaBottom,
  sendEnabled = true,
  onOpen,
  onGroup,
  onDetails,
  onStatus,
  onSend,
  onDelete,
  onCancel,
}) => {
  const _ = useTranslation();

  const hasSelection = selectedBooks.length > 0;
  const hasValidBooks = selectedBooks.every((id) => isMd5(id));
  const hasSingleSelection = selectedBooks.length === 1;
  const divRef = useKeyDownActions({ onCancel });

  return (
    <div
      ref={divRef}
      className='fixed bottom-0 left-0 right-0 z-40'
      style={{
        paddingBottom: `${safeAreaBottom + 16}px`,
      }}
    >
      <div
        className={clsx(
          'text-base-content text-xs shadow-lg',
          'not-eink:bg-base-300 eink:bg-base-100 eink:border eink:border-base-content',
          'mx-auto w-fit max-w-[calc(100vw-1rem)] rounded-lg p-4',
          'flex items-center justify-center gap-x-6',
          'max-[500px]:grid max-[500px]:grid-cols-4 max-[500px]:gap-x-6 max-[500px]:gap-y-3',
        )}
      >
        <button
          onClick={onOpen}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdOpenInNew />
          <div>{_('Open')}</div>
        </button>
        <button
          onClick={onGroup}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            !hasSelection && 'btn-disabled opacity-50',
          )}
        >
          <LuFolderPlus />
          <div>{_('Group')}</div>
        </button>
        <button
          onClick={onStatus}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdCheckCircleOutline />
          <div>{_('Status')}</div>
        </button>
        <button
          onClick={onDetails}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSingleSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdInfoOutline />
          <div>{_('Details')}</div>
        </button>
        {sendEnabled && (
          <button
            onClick={onSend}
            className={clsx(
              'flex flex-col items-center justify-center gap-1',
              // Wraps to the start of the second row on narrow viewports.
              'max-[500px]:col-start-1',
              (!hasSingleSelection || !hasValidBooks) && 'btn-disabled opacity-50',
            )}
          >
            <IoShareSocialOutline />
            <div>{_('Send')}</div>
          </button>
        )}
        <button
          onClick={onDelete}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            // Without Send (Linux/Windows/web), Delete needs an explicit
            // col-start-2 so the wrapped row {Delete, Cancel} stays centred
            // under the 4-col grid. With Send present, the layout is
            // {Send, Delete, Cancel} starting at col-start-1, so Delete
            // naturally lands in col-start-2 without an override.
            !sendEnabled && 'max-[500px]:col-start-2',
            !hasSelection && 'btn-disabled opacity-50',
          )}
        >
          <MdDelete className='text-red-500' />
          <div className='text-red-500'>{_('Delete')}</div>
        </button>
        <button onClick={onCancel} className='flex flex-col items-center justify-center gap-1'>
          <MdOutlineCancel />
          <div>{_('Cancel')}</div>
        </button>
      </div>
    </div>
  );
};

export default SelectModeActions;
