/**
 * Lifecycle bridge for the embedded LAN sync server (src-tauri/src/lan_sync).
 * Plain Tauri app commands — no plugin ACL involved. The server starts when
 * the integration is enabled (LanForm connect, LanSyncManager boot hook) and
 * stops on Disconnect; the sync traffic itself is driven by the engine through
 * LanSyncProvider, not through this module.
 */
import { invoke } from '@tauri-apps/api/core';

/** Mirror of the Rust `lan_sync::LanSyncStatus` (serde keeps snake_case). */
export interface LanSyncStatus {
  running: boolean;
  port: number;
  device_name: string;
  device_id: string;
  local_ips: string[];
}

/** Keep in sync with `lan_sync::DEFAULT_PORT` (src-tauri/src/lan_sync/mod.rs). */
export const DEFAULT_LAN_SYNC_PORT = 53430;

/**
 * Start the server, or no-op-return the status of the already-running one
 * (the Rust side is idempotent). Empty `deviceName` falls back to "Readest".
 */
export async function startLanSync(
  token: string,
  port: number = DEFAULT_LAN_SYNC_PORT,
  deviceName = '',
): Promise<LanSyncStatus> {
  return invoke<LanSyncStatus>('lan_sync_start', { token, port, deviceName });
}

export async function stopLanSync(): Promise<LanSyncStatus> {
  return invoke<LanSyncStatus>('lan_sync_stop');
}

export async function getLanSyncStatus(): Promise<LanSyncStatus> {
  return invoke<LanSyncStatus>('lan_sync_status');
}
