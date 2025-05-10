import clsx from 'clsx';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';

interface ImportMenuProps {
  setIsDropdownOpen?: (open: boolean) => void;
  onImportBooks: () => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({ setIsDropdownOpen, onImportBooks }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const handleImportBooks = () => {
    onImportBooks();
    setIsDropdownOpen?.(false);
  };

  return (
    <ul
      tabIndex={-1}
      className={clsx(
        'dropdown-content bg-base-100 menu rounded-box z-[1] mt-3 w-52 p-2 shadow',
        appService?.isMobile ? 'no-triangle' : 'dropdown-center',
      )}
    >
      <MenuItem label={_('From Local File')} onClick={handleImportBooks} />
    </ul>
  );
};

export default ImportMenu;
