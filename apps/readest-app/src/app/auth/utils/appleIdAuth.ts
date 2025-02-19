import { invoke } from '@tauri-apps/api/core';

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
  const result = await invoke<AppleIDAuthorizationResponse>(
    'plugin:sign-in-with-apple|get_apple_id_credential',
    {
      payload: request,
    },
  );

  return result;
}
