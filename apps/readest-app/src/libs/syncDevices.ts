import { getAPIBaseUrl } from '@/services/environment';
import { getDeviceLimit } from '@/utils/access';
import type { SyncDevicesResponse } from '@/utils/syncDevices';

const sessionsRequest = async (
  token: string,
  method: 'GET' | 'DELETE',
  body?: unknown,
): Promise<SyncDevicesResponse> => {
  const response = await fetch(`${getAPIBaseUrl()}/auth/sessions`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sessions request failed: ${response.status}`);
  return response.json();
};

export const fetchSyncDevices = (token: string) => sessionsRequest(token, 'GET');

export const signOutSyncDevice = (token: string, id: string) =>
  sessionsRequest(token, 'DELETE', { id });

/** Whether a sign-in has a device limit to check: the Free plan on Readest Cloud. */
export const hasDeviceLimit = (token: string): boolean => {
  try {
    return getDeviceLimit(token) !== null;
  } catch {
    // A token without readable claims has no plan to limit.
    return false;
  }
};

/**
 * The account's devices when this sign-in is over the plan's device limit, or
 * null when it may finish. An error never stops a sign-in: offline, or before
 * the server can answer, the check is skipped.
 */
export const checkSignInDeviceLimit = async (
  token: string,
): Promise<SyncDevicesResponse | null> => {
  if (!hasDeviceLimit(token)) return null;
  try {
    const response = await fetchSyncDevices(token);
    return response.blocked ? response : null;
  } catch (error) {
    console.warn('Skipped the device limit check:', error);
    return null;
  }
};
