import clsx from 'clsx';
import { MdDelete, MdOpenInNew, MdOutlineCancel, MdInfoOutline } from 'react-icons/md';
import { LuFolderPlus } from 'react-icons/lu';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { isMd5 } from '@/utils/md5';

interface SelectModeActionsProps {
  selectedBooks: string[];
  safeAreaBottom: number;
  onOpen: () => void;
  onGroup: () => void;
  onDetails: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

const SelectModeActions: React.FC<SelectModeActionsProps> = ({
  selectedBooks,
  safeAreaBottom,
  onOpen,
  onGroup,
  onDetails,
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
          'text-base-content flex items-center justify-center text-xs shadow-lg',
          'not-eink:bg-base-300 eink:bg-base-100 eink:border eink:border-base-content',
          'mx-auto w-fit space-x-6 rounded-lg p-4',
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
          onClick={onDetails}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
            (!hasSingleSelection || !hasValidBooks) && 'btn-disabled opacity-50',
          )}
        >
          <MdInfoOutline />
          <div>{_('Details')}</div>
        </button>
        <button
          onClick={onDelete}
          className={clsx(
            'flex flex-col items-center justify-center gap-1',
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
