// Paired (trusted) Nearby BookDrop devices, stored per device in localStorage
// like the other LocalSend prefs: trust is a property of THIS device, so the
// list is deliberately not synced. Keyed on the peer's TLS cert fingerprint,
// which is stable across restarts (the peer persists its identity.pem).

const PAIRED_KEY = 'readest-localsend-paired';

export interface PairedDevice {
  fingerprint: string;
  alias: string;
  deviceModel: string | null;
  pairedAt: number;
}

const isPairedDeviceRecord = (value: unknown): value is PairedDevice => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['fingerprint'] === 'string' && typeof record['alias'] === 'string';
};

export function getPairedDevices(): PairedDevice[] {
  try {
    const raw = localStorage.getItem(PAIRED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPairedDeviceRecord);
  } catch {
    return [];
  }
}

function savePairedDevices(devices: PairedDevice[]): void {
  try {
    localStorage.setItem(PAIRED_KEY, JSON.stringify(devices));
  } catch {
    /* localStorage unavailable — trust simply does not persist */
  }
}

export function isPairedDevice(fingerprint: string): boolean {
  return getPairedDevices().some((device) => device.fingerprint === fingerprint);
}

export function addPairedDevice(device: {
  fingerprint: string;
  alias: string;
  deviceModel: string | null;
}): void {
  const rest = getPairedDevices().filter((d) => d.fingerprint !== device.fingerprint);
  savePairedDevices([...rest, { ...device, pairedAt: Date.now() }]);
}

export function removePairedDevice(fingerprint: string): void {
  savePairedDevices(getPairedDevices().filter((d) => d.fingerprint !== fingerprint));
}

/**
 * Keep the stored identity fresh: a paired peer that renamed itself updates
 * its own record on each auto-accepted transfer. Unknown fingerprints are
 * ignored — refreshing must never create trust.
 */
export function refreshPairedDevice(
  fingerprint: string,
  alias: string,
  deviceModel: string | null,
): void {
  const devices = getPairedDevices();
  const existing = devices.find((d) => d.fingerprint === fingerprint);
  if (!existing) return;
  if (existing.alias === alias && existing.deviceModel === deviceModel) return;
  savePairedDevices(
    devices.map((d) => (d.fingerprint === fingerprint ? { ...d, alias, deviceModel } : d)),
  );
}

/**
 * Whether an incoming transfer may skip the confirmation dialog. Only a
 * paired sender whose fingerprint came from the TLS client cert qualifies:
 * the body fingerprint is attacker-chosen, so a cert-less sender (e.g. the
 * stock LocalSend app) always confirms no matter what. The entitlement is
 * checked at receive time so a lapsed plan brings the dialogs back while the
 * pairing records stay intact.
 */
export function canAutoAccept(
  sender: { fingerprint: string; certVerified: boolean },
  entitled: boolean,
): boolean {
  return entitled && sender.certVerified && isPairedDevice(sender.fingerprint);
}
