import { invoke, PermissionState } from '@tauri-apps/api/core';

interface Permissions {
  manageStorage: PermissionState;
}

export const requestStoragePermission = async (): Promise<boolean> => {
  let permission = await invoke<Permissions>('plugin:native-bridge|checkPermissions');
  if (permission.manageStorage !== 'granted') {
    permission = await invoke<Permissions>(
      'plugin:native-bridge|request_manage_storage_permission',
    );
  }
  return permission.manageStorage === 'granted';
};
