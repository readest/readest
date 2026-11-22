import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { deleteUser } from '@/libs/user';
import { deleteAllBooks } from '@/services/deleteLibraryService';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary, navigateToResetPassword, navigateToUpdatePassword } from '@/utils/nav';

export const useUserActions = () => {
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { logout } = useAuth();
  // Lets the profile page skip its hand-off to the login page while it leaves.
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    logout();
    // The library sends a signed-out user to the login page when keepLogin is
    // set, so leave only once it is cleared on disk (#7726). Leave on a failed
    // write too: the page can't show a signed-out profile.
    await saveSysSettings(envConfig, 'keepLogin', false).catch((error) =>
      console.error('Failed to clear keepLogin:', error),
    );
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

  const handleDeleteAllBooks = async (successMessage: string, errorMessage: string) => {
    if (!appService) return;
    try {
      await deleteAllBooks(appService);
      useLibraryStore.getState().setLibrary([]);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: successMessage,
      });
    } catch (error) {
      console.error('Error deleting all books:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  return {
    signingOut,
    handleLogout,
    handleUpdateEmail,
    handleResetPassword,
    handleConfirmDelete,
    handleDeleteAllBooks,
  };
};
