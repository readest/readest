import { invoke } from '@tauri-apps/api/core';

export interface CopyURIRequest {
  uri: string;
  dst: string;
}

export interface CopyURIResponse {
  success: boolean;
  error?: string;
}

export async function copyURIToPath(request: CopyURIRequest): Promise<CopyURIResponse> {
  const result = await invoke<CopyURIResponse>('plugin:native-bridge|copy_uri_to_path', {
    payload: request,
  });

  return result;
}
