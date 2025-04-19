import { invoke } from '@tauri-apps/api/core';

export interface CopyURIRequest {
  uri: string;
  dst: string;
}

export interface CopyURIResponse {
  success: boolean;
  error?: string;
}

export interface UseBackgroundAudioRequest {
  enabled: boolean;
}

export interface InstallPackageRequest {
  path: string;
}

export interface InstallPackageResponse {
  success: boolean;
  error?: string;
}

export interface SetSystemUIVisibilityRequest {
  visible: boolean;
  darkMode: boolean;
}

export interface SetSystemUIVisibilityResponse {
  success: boolean;
  error?: string;
}

export async function copyURIToPath(request: CopyURIRequest): Promise<CopyURIResponse> {
  const result = await invoke<CopyURIResponse>('plugin:native-bridge|copy_uri_to_path', {
    payload: request,
  });

  return result;
}

export async function invokeUseBackgroundAudio(request: UseBackgroundAudioRequest): Promise<void> {
  await invoke('plugin:native-bridge|use_background_audio', {
    payload: request,
  });
}

export async function installPackage(
  request: InstallPackageRequest,
): Promise<InstallPackageResponse> {
  const result = await invoke<InstallPackageResponse>('plugin:native-bridge|install_package', {
    payload: request,
  });
  return result;
}

export async function setSystemUIVisibility(
  request: SetSystemUIVisibilityRequest,
): Promise<SetSystemUIVisibilityResponse> {
  const result = await invoke<SetSystemUIVisibilityResponse>(
    'plugin:native-bridge|set_system_ui_visibility',
    {
      payload: request,
    },
  );
  return result;
}
