import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type as osType } from '@tauri-apps/plugin-os';

export type Scope = 'fullName' | 'email';
export interface AppleIDAuthorizationRequest {
  scope: Scope[];
  nonce?: string;
  state?: string;
}

export interface AppleIDAuthorizationResponse {
  // usually not null
  userIdentifier: string | null;

  givenName: string | null;
  familyName: string | null;
  email: string | null;

  authorizationCode: string;
  identityToken: string | null;
  state: string | null;
}

export async function getAppleIdAuth(
  request: AppleIDAuthorizationRequest,
): Promise<AppleIDAuthorizationResponse> {
  const OS_TYPE = osType();
  if (OS_TYPE === 'ios') {
    const result = await invoke<AppleIDAuthorizationResponse>(
      'plugin:sign-in-with-apple|get_apple_id_credential',
      {
        payload: request,
      },
    );

    return result;
  } else if (OS_TYPE === 'macos') {
    return new Promise<AppleIDAuthorizationResponse>(async (resolve, reject) => {
      const unlistenComplete = await listen<AppleIDAuthorizationResponse>(
        'apple-sign-in-complete',
        ({ payload }) => {
          cleanup();
          resolve(payload);
        },
      );

      const unlistenError = await listen<string>('apple-sign-in-error', ({ payload }) => {
        cleanup();
        reject(
          typeof payload === 'string' ? new Error(payload) : new Error('Apple sign‑in failed'),
        );
      });

      function cleanup() {
        unlistenComplete();
        unlistenError();
      }

      try {
        await invoke('start_apple_sign_in', { payload: request });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  } else {
    throw new Error('Unsupported platform');
  }
}
