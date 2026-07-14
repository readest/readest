import clsx from 'clsx';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { useImportOptions } from './importOptions';
import type { ImportOptionHandlers } from './importOptions';

interface ImportMenuProps extends ImportOptionHandlers {
  setIsDropdownOpen?: (open: boolean) => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({
  setIsDropdownOpen,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
}) => {
  const options = useImportOptions({
    onImportBooksFromFiles,
    onImportBooksFromDirectory,
    onImportBookFromUrl,
    onOpenCatalogManager,
  });

  return (
    <Menu
      className={clsx('dropdown-content bg-base-100 rounded-box !relative z-[1] mt-3 p-2 shadow')}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {options.map(({ id, label, Icon, onSelect }) => (
        <MenuItem
          key={id}
          label={label}
          Icon={<Icon className='h-5 w-5' />}
          onClick={() => {
            onSelect();
            setIsDropdownOpen?.(false);
          }}
        />
      ))}
    </Menu>
  );
};

export default ImportMenu;
