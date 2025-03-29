import { invoke } from '@tauri-apps/api/core';

export interface SafariAuthRequest {
  authUrl: string;
}

export interface SafariAuthResponse {
  redirectUrl: string;
}

export async function authWithSafari(request: SafariAuthRequest): Promise<SafariAuthResponse> {
  const result = await invoke<SafariAuthResponse>('plugin:native-bridge|auth_with_safari', {
    payload: request,
  });

  return result;
}
