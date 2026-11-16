import { v4 as uuidv4 } from 'uuid';
import type { SystemSettings } from '@/types/settings';

/**
 * Device identity vs. iOS device migration (#7558).
 *
 * Apple's device-to-device migration copies the app container wholesale —
 * settings.json included — so the KOSync / BookOrbit / replica device IDs
 * minted on the old iPhone arrive on the new one unchanged, and two
 * physical devices end up sharing one sync identity. Conflict detection
 * then treats them as the same device (1% threshold instead of 0.01%, and
 * no remote XPointer-to-CFI resolution).
 *
 * The anchor that tells the devices apart lives outside the migrating
 * container: a keychain item stored device-bound (iOS
 * `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Such items do not
 * transfer to another device, so a migrated install finds its stored IDs
 * but no anchor — and mints fresh ones. The anchor is only a marker; the
 * value is a throwaway UUID.
 */

/** Secure-KV key holding the device-bound anchor. */
export const DEVICE_ANCHOR_KEY = 'readest.device-anchor';

export interface DeviceAnchorStore {
  loadAnchor(): Promise<{ value?: string; error?: string }>;
  saveAnchor(value: string): Promise<{ success: boolean; error?: string }>;
  clearAnchor(): Promise<void>;
}

/** Wires the anchor store to the OS keychain via the native bridge. */
export const createDeviceAnchorStore = async (): Promise<DeviceAnchorStore> => {
  const { clearSecureItem, getSecureItem, setSecureItem } = await import('@/utils/bridge');
  return {
    loadAnchor: () => getSecureItem({ key: DEVICE_ANCHOR_KEY }),
    saveAnchor: (value: string) =>
      setSecureItem({ key: DEVICE_ANCHOR_KEY, value, deviceBound: true }),
    clearAnchor: async () => {
      await clearSecureItem({ key: DEVICE_ANCHOR_KEY });
    },
  };
};

/**
 * Mint fresh per-device sync identities, preserving everything else
 * (books, annotations, account settings, device names). `koreaderSyncDeviceId`
 * is deliberately untouched: nothing reads it.
 */
export function regenerateSyncDeviceIds(settings: SystemSettings): void {
  settings.kosync.deviceId = uuidv4();
  settings.bookorbit.deviceId = uuidv4();
  settings.replicaDeviceId = uuidv4();
}

/**
 * Reconcile the stored sync identities with the physical device.
 *
 * `hadStoredDeviceIds` is true when the loaded settings already carried
 * sync device IDs (i.e. a settings file existed before this launch).
 * Returns true when the IDs were regenerated. Never throws for keychain
 * trouble — a keychain failure leaves the stored IDs alone so startup is
 * never blocked by secure storage; the check retries on the next launch.
 */
export async function ensureDeviceIdentity(
  settings: SystemSettings,
  hadStoredDeviceIds: boolean,
  store: DeviceAnchorStore,
  saveSettings: () => Promise<void>,
): Promise<boolean> {
  let anchor: { value?: string; error?: string };
  try {
    anchor = await store.loadAnchor();
  } catch (err) {
    console.warn('[deviceIdentity] device anchor read failed; keeping stored device IDs', err);
    return false;
  }
  if (anchor.error) {
    console.warn(
      '[deviceIdentity] device anchor read failed; keeping stored device IDs',
      anchor.error,
    );
    return false;
  }
  if (anchor.value) return false;

  const freshAnchor = uuidv4();
  if (!hadStoredDeviceIds) {
    // Fresh install: the IDs were just minted, nothing to regenerate.
    // Anchor this device so a later migration is detectable. Best-effort:
    // a failed write retries on the next launch.
    try {
      await store.saveAnchor(freshAnchor);
    } catch (err) {
      console.warn('[deviceIdentity] device anchor write failed; will retry next launch', err);
    }
    return false;
  }

  // Stored device IDs but no device-bound anchor: this app container was
  // migrated to another physical device. Mint fresh sync identities so
  // this device stops impersonating the old one. Save first: if the anchor
  // write then fails, the next launch regenerates again instead of keeping
  // a duplicated identity.
  regenerateSyncDeviceIds(settings);
  await saveSettings();
  try {
    await store.saveAnchor(freshAnchor);
  } catch (err) {
    console.warn(
      '[deviceIdentity] device anchor write failed; IDs were regenerated and will be re-anchored next launch',
      err,
    );
  }
  return true;
}
