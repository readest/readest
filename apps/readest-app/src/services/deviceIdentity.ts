import { v4 as uuidv4 } from 'uuid';
import { getSecureItem, setSecureItem } from '@/utils/bridge';
import type { SystemSettings } from '@/types/settings';

/**
 * iOS device-to-device migration copies the app container, settings.json
 * included, so the new iPhone arrives with the old one's KOSync, BookOrbit
 * and replica device IDs (#7558). A keychain item stored ThisDeviceOnly does
 * not migrate, so each device keeps an anchor there and settings.json keeps a
 * copy of it. When the two differ, settings.json came from another device.
 */
const DEVICE_ANCHOR_KEY = 'readest.device-anchor';

interface DeviceIdentity {
  anchor: string;
  kosyncDeviceId: string;
  bookorbitDeviceId: string;
  replicaDeviceId: string;
}

let identityCheck: Promise<DeviceIdentity | null> | null = null;

async function checkDeviceIdentity(settings: SystemSettings): Promise<DeviceIdentity | null> {
  const stored = await getSecureItem({ key: DEVICE_ANCHOR_KEY });
  if (stored.error) throw new Error(stored.error);
  if (stored.value && stored.value === settings.deviceAnchor) return null;

  let anchor = stored.value;
  if (!anchor) {
    anchor = uuidv4();
    const saved = await setSecureItem({ key: DEVICE_ANCHOR_KEY, value: anchor, deviceBound: true });
    if (!saved.success) throw new Error(saved.error);
  }
  // No anchor in settings.json: a fresh install, or the first launch after
  // updating to this check. The stored IDs were made on this device.
  if (!settings.deviceAnchor) {
    return {
      anchor,
      kosyncDeviceId: settings.kosync.deviceId,
      bookorbitDeviceId: settings.bookorbit.deviceId,
      replicaDeviceId: settings.replicaDeviceId!,
    };
  }
  // settings.json carries another device's anchor: it was migrated here.
  return {
    anchor,
    kosyncDeviceId: uuidv4(),
    bookorbitDeviceId: uuidv4(),
    replicaDeviceId: uuidv4(),
  };
}

/**
 * Gives this device its own sync IDs when settings.json came from another
 * device. The keychain is checked once per app session; if it can't be read
 * or written, the stored IDs stay and the next launch checks again. Returns
 * true when `settings` changed and needs saving.
 */
export async function ensureDeviceIdentity(settings: SystemSettings): Promise<boolean> {
  identityCheck ??= checkDeviceIdentity(settings).catch((err) => {
    console.warn('[deviceIdentity] keychain check failed; keeping the stored device IDs', err);
    return null;
  });
  const identity = await identityCheck;
  if (!identity || settings.deviceAnchor === identity.anchor) return false;
  settings.deviceAnchor = identity.anchor;
  settings.kosync.deviceId = identity.kosyncDeviceId;
  settings.bookorbit.deviceId = identity.bookorbitDeviceId;
  settings.replicaDeviceId = identity.replicaDeviceId;
  return true;
}
