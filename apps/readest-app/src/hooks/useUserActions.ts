import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary, navigateToResetPassword, navigateToUpdatePassword } from '@/utils/nav';

export const useUserActions = () => {
  const router = useRouter();
  const { envConfig } = useEnv();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    saveSysSettings(envConfig, 'keepLogin', false);
    navigateToLibrary(router);
  };

  const handleResetPassword = () => {
    navigateToResetPassword(router);
  };

  const handleUpdateEmail = () => {
    navigateToUpdatePassword(router);
  };

  const handleConfirmDelete = async (errorMessage: string) => {
    try {
      await deleteUser();
      handleLogout();
    } catch (error) {
      console.error('Error deleting user:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  return {
    handleLogout,
    handleUpdateEmail,
    handleResetPassword,
    handleConfirmDelete,
  };
};
