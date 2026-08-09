// Per-device LocalSend preferences, stored in localStorage (not synced
// across devices): each device opts into being a LocalSend peer on its own.

const ENABLED_KEY = 'readest-localsend-enabled';
const ALIAS_KEY = 'readest-localsend-alias';

/** Whether this device runs the LocalSend service. Defaults to false (opt-in). */
export function isLocalSendEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setLocalSendEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    /* localStorage unavailable — the default (disabled) stands */
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
