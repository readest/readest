import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdCheck } from 'react-icons/md';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { navigateToLogin } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';

interface ImportMenuProps {
  setIsDropdownOpen?: (open: boolean) => void;
  onImportBooks: () => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({ setIsDropdownOpen, onImportBooks }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [isAutoUpload, setIsAutoUpload] = useState(settings.autoUpload);

  const toggleAutoUploadBooks = () => {
    if (!user) {
      navigateToLogin(router);
    }
    settings.autoUpload = !settings.autoUpload;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAutoUpload(settings.autoUpload);
    setIsDropdownOpen?.(false);
  };

  const handleImportBooks = () => {
    onImportBooks();
    setIsDropdownOpen?.(false);
  };

  return (
    <ul
      tabIndex={-1}
      className='dropdown-content dropdown-center bg-base-100 menu rounded-box z-[1] mt-3 w-52 p-2 shadow'
    >
      <MenuItem label={_('From Local File')} onClick={handleImportBooks} />
      <MenuItem
        label={_('Auto Upload Books to Cloud')}
        icon={isAutoUpload ? <MdCheck className='text-base-content' /> : undefined}
        onClick={toggleAutoUploadBooks}
      />
    </ul>
  );
};

export default ImportMenu;
