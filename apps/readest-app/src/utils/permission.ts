import { invoke, PermissionState } from '@tauri-apps/api/core';

interface Permissions {
  manageStorage: PermissionState;
}

/**
 * Whether a thrown error is an Android storage-permission denial (EACCES). A
 * custom library folder on shared storage needs All Files Access; without it
 * file writes fail with "Permission denied (os error 13)".
 */
export const isStoragePermissionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /os error 13|permission denied|eacces/i.test(message);
};

export const requestStoragePermission = async (): Promise<boolean> => {
  let permission = await invoke<Permissions>('plugin:native-bridge|checkPermissions');
  if (permission.manageStorage !== 'granted') {
    permission = await invoke<Permissions>(
      'plugin:native-bridge|request_manage_storage_permission',
    );
  }
  return permission.manageStorage === 'granted';
};
