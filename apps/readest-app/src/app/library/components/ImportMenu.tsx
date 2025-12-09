import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { IoFileTray } from 'react-icons/io5';
import { MdRssFeed } from 'react-icons/md';

import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface ImportMenuProps {
  setIsDropdownOpen?: (open: boolean) => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onOpenCatalogManager: () => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({
  setIsDropdownOpen,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onOpenCatalogManager,
}) => {
  const _ = useTranslation();

  const handleImportFromFiles = () => {
    onImportBooksFromFiles();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromDirectory = () => {
    onImportBooksFromDirectory?.();
    setIsDropdownOpen?.(false);
  };

  const handleOpenCatalogManager = () => {
    onOpenCatalogManager();
    setIsDropdownOpen?.(false);
  };

  return (
    <Menu
      className={clsx('dropdown-content bg-base-100 rounded-box z-[1] mt-3 p-2 shadow')}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('From Local File')}
        Icon={<IoFileTray className='h-5 w-5' />}
        onClick={handleImportFromFiles}
      />
      {onImportBooksFromDirectory && (
        <MenuItem
          label={_('From Directory')}
          Icon={<IoFileTray className='h-5 w-5' />}
          onClick={handleImportFromDirectory}
        />
      )}
      <MenuItem
        label={_('Online Library')}
        Icon={<MdRssFeed className='h-5 w-5' />}
        onClick={handleOpenCatalogManager}
      />
    </Menu>
  );
};

export default ImportMenu;
