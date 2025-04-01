import { invoke } from '@tauri-apps/api/core';

export interface AuthRequest {
  authUrl: string;
}

export interface AuthResponse {
  redirectUrl: string;
}

export async function authWithSafari(request: AuthRequest): Promise<AuthResponse> {
  const result = await invoke<AuthResponse>('plugin:native-bridge|auth_with_safari', {
    payload: request,
  });

  return result;
}

export async function authWithCustomTab(request: AuthRequest): Promise<AuthResponse> {
  const result = await invoke<AuthResponse>('plugin:native-bridge|auth_with_custom_tab', {
    payload: request,
  });

  return result;
}
