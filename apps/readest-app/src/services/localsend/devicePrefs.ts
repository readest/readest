// Per-device LocalSend preferences, stored in localStorage (not synced
// across devices): each device opts into being a LocalSend peer on its own.

import { stubTranslation as _ } from '@/utils/misc';

const ENABLED_KEY = 'readest-localsend-enabled';
const ALIAS_KEY = 'readest-localsend-alias';

// i18n key for the default alias when the signed-in user's name is known
// (AirDrop-style "<name>'s Readest"). The `{{name}}` placeholder is filled by
// the real `_()` in LocalSendManager; `stubTranslation` here only registers
// the key for extraction (the scanner reads `_('...')` literals).
export const DEFAULT_ALIAS_NAMED_KEY = _("{{name}}'s Readest");

/**
 * Whether this device runs the LocalSend service. Defaults to true.
 *
 * Starting the service joins a multicast group and binds a LAN listener, so
 * the first launch spends the iOS Local Network permission prompt (and the
 * macOS firewall dialog) before the user has heard of Nearby BookDrop. That
 * cost buys discoverability: a peer that is off is a peer nobody finds, and
 * the feature only works when both ends are running. Turning it off in
 * Settings stops the service.
 */
export function isLocalSendEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setLocalSendEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    /* localStorage unavailable — the default (enabled) stands */
  }
}

/** The device alias announced to peers. Empty string means "use the default". */
export function getLocalSendAlias(): string {
  try {
    return localStorage.getItem(ALIAS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setLocalSendAlias(alias: string): void {
  try {
    localStorage.setItem(ALIAS_KEY, alias);
  } catch {
    /* localStorage unavailable — default alias stands */
  }
}
