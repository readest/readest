import React from 'react';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import { MdArrowBackIosNew, MdArrowForwardIos } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { getDirFromUILanguage } from '@/utils/rtl';
import { getFilename } from '@/utils/path';
import BoxedList from '@/components/settings/primitives/BoxedList';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';

export interface WatchedFolder {
  /** Absolute path, exactly as stored in `settings.autoImportFolders`. */
  path: string;
  /**
   * `true` when this folder's auto-imported books go straight to the library
   * root ("Import all into library"); `false` mirrors its subfolders as groups.
   */
  flatten: boolean;
}

interface WatchedFoldersPaneProps {
  folders: WatchedFolder[];
  onBack: () => void;
  /** Stop auto-importing from `path`. The folder stays readable in place. */
  onUnwatch: (path: string) => void;
  onSetFlatten: (path: string, flatten: boolean) => void;
}

/**
 * Sub-page of the Import-from-Folder dialog listing every folder the user has
 * opted into auto-import, so a folder can be dropped or re-pointed without
 * hunting down its path in the picker again — until this existed, unwatching
 * meant re-selecting the exact folder and unticking a checkbox.
 *
 * Edits apply immediately (the caller persists them); Cancel on the parent
 * dialog does not roll them back, same as any settings pane.
 */
const WatchedFoldersPane: React.FC<WatchedFoldersPaneProps> = ({
  folders,
  onBack,
  onUnwatch,
  onSetFlatten,
}) => {
  const _ = useTranslation();
  const isRtl = getDirFromUILanguage() === 'rtl';
  const BackIcon = isRtl ? MdArrowForwardIos : MdArrowBackIosNew;

  return (
    <div className='flex flex-col gap-3 pt-2'>
      {/* Deliberately not <SubPageHeader>: its breadcrumb repeats the parent
          label, which the dialog's own title bar already shows. */}
      <div className='flex flex-col gap-1'>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={onBack}
            className='btn btn-ghost btn-sm px-1'
            aria-label={_('Back')}
            title={_('Back')}
          >
            <BackIcon className='h-4 w-4' />
          </button>
          <span className='text-base font-semibold tracking-tight'>{_('Watched Folders')}</span>
        </div>
        <span className='text-base-content/65 text-[0.85em] leading-relaxed'>
          {_(
            'Readest re-scans these folders when it opens or returns to the foreground and imports any new books. Each folder keeps the structure it was imported with.',
          )}
        </span>
      </div>

      {folders.length === 0 ? (
        <span className='text-base-content/65 py-4 text-center text-[0.85em]'>
          {_('No folders are watched.')}
        </span>
      ) : (
        <BoxedList>
          {folders.map((folder) => (
            <div key={folder.path} className='flex items-center gap-2 py-2 pe-2'>
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium' title={folder.path}>
                  {getFilename(folder.path) || folder.path}
                </div>
                <div className='text-base-content/65 truncate text-[0.85em]'>{folder.path}</div>
              </div>
              <SettingsSelect
                value={folder.flatten ? 'flatten' : 'keep'}
                onChange={(e) => onSetFlatten(folder.path, e.target.value === 'flatten')}
                options={[
                  { value: 'keep', label: _('Groups') },
                  { value: 'flatten', label: _('Flat') },
                ]}
                ariaLabel={_('Folder Structure')}
              />
              <button
                type='button'
                onClick={() => onUnwatch(folder.path)}
                className='btn btn-ghost btn-sm shrink-0 px-1'
                aria-label={_('Stop watching')}
                title={_('Stop watching')}
              >
                <IoMdCloseCircleOutline className='text-base-content/75 h-5 w-5' />
              </button>
            </div>
          ))}
        </BoxedList>
      )}
    </div>
  );
};

export default WatchedFoldersPane;
