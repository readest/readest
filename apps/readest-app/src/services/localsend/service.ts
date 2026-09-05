import { invoke } from '@tauri-apps/api/core';
import type { LocalSendDevice, LocalSendStatus, SendFileInput } from './types';

export async function startLocalSend(alias: string, deviceModel: string): Promise<LocalSendStatus> {
  return invoke<LocalSendStatus>('localsend_start', { alias, deviceModel });
}

export async function stopLocalSend(): Promise<void> {
  await invoke('localsend_stop');
}

export async function getLocalSendStatus(): Promise<LocalSendStatus> {
  return invoke<LocalSendStatus>('localsend_get_status');
}

export async function listLocalSendDevices(): Promise<LocalSendDevice[]> {
  return invoke<LocalSendDevice[]>('localsend_list_devices');
}

export async function announceLocalSend(scan: boolean): Promise<void> {
  await invoke('localsend_announce', { scan });
}

/**
 * Whether the running service can still accept connections.
 *
 * iOS reclaims a suspended app's listening socket without ever failing the
 * accept loop, so the service keeps reporting `running: true` while no peer
 * can reach it. Probe this on the way back to the foreground rather than
 * trusting the stored status.
 */
export async function isLocalSendAlive(): Promise<boolean> {
  return await invoke<boolean>('localsend_is_alive');
}

/**
 * Presence gate (not a connection): when this device's screen locks or the app
 * is backgrounded, `active = false` stops it answering announcements, so peers
 * age it out of their pickers within a few seconds. `active = true` makes it
 * answer again and announce once, so open pickers re-list it immediately.
 */
export async function setLocalSendDiscoverable(active: boolean): Promise<void> {
  await invoke('localsend_set_discoverable', { active });
}

/**
 * Answer a pending receive request. `acceptFileIds` empty/null declines.
 * Returns whether this call claimed the request; a `false` means another
 * window answered first (or the sender aborted) and the caller must not
 * treat the session as its own.
 */
export async function respondLocalSend(
  sessionId: string,
  acceptFileIds: string[] | null,
): Promise<boolean> {
  return invoke<boolean>('localsend_respond', { sessionId, acceptFileIds });
}

export async function cancelLocalSendReceive(sessionId: string): Promise<void> {
  await invoke('localsend_cancel_receive', { sessionId });
}

export async function sendLocalSendFiles(
  fingerprint: string,
  files: SendFileInput[],
): Promise<void> {
  await invoke('localsend_send_files', { fingerprint, files });
}

export async function cancelLocalSendSend(): Promise<void> {
  await invoke('localsend_cancel_send');
}
