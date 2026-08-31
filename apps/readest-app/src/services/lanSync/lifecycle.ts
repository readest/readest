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
  /** MD5 fingerprint used to detect a running server with a stale token. */
  token_fingerprint: string;
  /** Monotonic Rust-side epoch used to reject stale starts across windows. */
  generation: number;
  /** True only when the start call created the running server. */
  started: boolean;
}

/** Keep in sync with `lan_sync::DEFAULT_PORT` (src-tauri/src/lan_sync/mod.rs). */
export const DEFAULT_LAN_SYNC_PORT = 53430;

/** Generate the 32-hex-character token shared by both LAN peers. */
export const generateLanSyncToken = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

let lanSyncLifecycleQueue: Promise<unknown> = Promise.resolve();
let lanSyncGeneration = 0;

const enqueueLanSyncLifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = lanSyncLifecycleQueue.then(operation);
  lanSyncLifecycleQueue = result.catch(() => {});
  return result;
};

export const getLanSyncGeneration = (): number => lanSyncGeneration;

/** Invalidate starts that were initiated before a stop/disconnect intent. */
export const invalidateLanSyncGeneration = (): number => ++lanSyncGeneration;

const startLanSyncAtGeneration = async (
  token: string,
  port: number,
  deviceName: string,
  expectedGeneration?: number,
): Promise<LanSyncStatus> => {
  const current = await invoke<LanSyncStatus>('lan_sync_status');
  const generation = expectedGeneration ?? current.generation;
  const next = await invoke<LanSyncStatus>('lan_sync_start', {
    token,
    port,
    deviceName,
    expectedGeneration: generation,
  });
  if (!next.started && next.generation !== generation) {
    throw new Error('lan_sync start superseded by a newer lifecycle operation');
  }
  return next;
};

/**
 * Start the server, or no-op-return the status of the already-running one
 * (the Rust side is idempotent). Empty `deviceName` falls back to "Readest".
 */
export function startLanSync(
  token: string,
  port: number = DEFAULT_LAN_SYNC_PORT,
  deviceName = '',
  expectedGeneration?: number,
): Promise<LanSyncStatus> {
  return enqueueLanSyncLifecycle(() =>
    startLanSyncAtGeneration(token, port, deviceName, expectedGeneration),
  );
}

/** Replace the server token as one serialized lifecycle operation. */
export function replaceLanSyncToken(
  token: string,
  previousToken: string,
  port: number = DEFAULT_LAN_SYNC_PORT,
  deviceName = '',
  expectedGeneration?: number,
): Promise<LanSyncStatus> {
  return enqueueLanSyncLifecycle(async () => {
    const current = await invoke<LanSyncStatus>('lan_sync_status');
    const generation = expectedGeneration ?? current.generation;
    const replacementGeneration = generation + 1;
    let startResponseReceived = false;
    try {
      const next = await invoke<LanSyncStatus>('lan_sync_start', {
        token,
        port,
        deviceName,
        expectedGeneration: generation,
      });
      startResponseReceived = true;
      if (!next.started && next.generation !== generation) {
        throw new Error('lan_sync replacement superseded by a newer lifecycle operation');
      }
      return next;
    } catch (error) {
      const after = await invoke<LanSyncStatus>('lan_sync_status');
      const canRestore =
        after.generation === generation ||
        (!startResponseReceived && after.generation === replacementGeneration);
      if (canRestore) {
        try {
          await invoke<LanSyncStatus>('lan_sync_start', {
            token: previousToken,
            port,
            deviceName,
            expectedGeneration: after.generation,
          });
        } catch {
          // Preserve the original replacement failure.
        }
      }
      throw error;
    }
  });
}

export function stopLanSync(): Promise<LanSyncStatus> {
  invalidateLanSyncGeneration();
  return enqueueLanSyncLifecycle(() => invoke<LanSyncStatus>('lan_sync_stop'));
}

/** Stop only if the server is still the instance owned by this cleanup. */
export function stopLanSyncIfCurrent(expectedGeneration: number): Promise<LanSyncStatus> {
  return enqueueLanSyncLifecycle(() =>
    invoke<LanSyncStatus>('lan_sync_stop', { expectedGeneration }),
  );
}

export function getLanSyncStatus(): Promise<LanSyncStatus> {
  return enqueueLanSyncLifecycle(() => invoke<LanSyncStatus>('lan_sync_status'));
}
