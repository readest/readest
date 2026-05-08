import type { SystemSettings } from '@/types/settings';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { FieldsObject, ReplicaRow } from '@/types/replica';
import { unwrap } from './helpers';

export const SETTINGS_KIND = 'settings';
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * Stable replica_id for the singleton settings row. The kind is
 * capped at maxRowsPerUser=1 server-side so this id is unique per
 * user. Kept short to limit fields_jsonb overhead.
 */
export const SETTINGS_REPLICA_ID = 'singleton';

/**
 * Whitelist of SystemSettings keys that sync via the bundled
 * `settings` row. Each entry is a dot-path into SystemSettings so
 * nested values (`globalViewSettings.uiLanguage`) and flat-map
 * settings (future: `providerEnabled.<id>`) live alongside top-level
 * scalars. Adding a new synced setting is a one-line addition.
 *
 * Notable exclusions:
 *   * Device-specific paths (`localBooksDir`, `lastOpenBooks`,
 *     `screenBrightness`, `customRootDir`) — wouldn't make sense
 *     across devices.
 *   * Collection settings already synced via dedicated kinds
 *     (`customFonts`, `customTextures`, `customDictionaries`,
 *     `opdsCatalogs`, `dictionarySettings`).
 */
export const SETTINGS_WHITELIST = [
  'globalReadSettings.customThemes',
  'globalReadSettings.customHighlightColors',
  'globalReadSettings.userHighlightColors',
  'globalReadSettings.defaultHighlightLabels',
  'globalReadSettings.customTtsHighlightColors',
  // External integrations. Server URL + identifiers sync as plaintext;
  // the credential fields are listed in `encryptedFields` below so the
  // publish/pull middleware wraps them in cipher envelopes.
  'kosync.serverUrl',
  'kosync.username',
  'kosync.userkey',
  'kosync.password',
  'readwise.accessToken',
  'hardcover.accessToken',
] as const;

/**
 * Whitelisted paths whose values are credentials. The publish/pull
 * crypto middleware wraps these in cipher envelopes via the active
 * CryptoSession; pack / unpack themselves only see plaintext.
 *
 * Best-effort encryption: when the session is locked we drop the
 * field from the push (no plaintext leak) and skip applying it on
 * pull. The user explicitly unlocks via the Sync passphrase panel
 * (or via an OPDS prompt) to enable cross-device credential sync.
 * Settings sync deliberately does NOT trigger the lazy passphrase
 * prompt itself — credential sync is opt-in via that explicit
 * unlock; the rest of the bundled settings keep syncing quietly.
 */
export const SETTINGS_ENCRYPTED_FIELDS = [
  'kosync.username',
  'kosync.userkey',
  'kosync.password',
  'readwise.accessToken',
  'hardcover.accessToken',
] as const;

export type SettingsWhitelistKey = (typeof SETTINGS_WHITELIST)[number];

// In practice every path comes from the compile-time SETTINGS_WHITELIST so
// these never appear, but readPath/writePath are exported helpers and the
// guard makes prototype pollution impossible if a future caller passes an
// untrusted path.
const isUnsafeKey = (k: string): boolean =>
  k === '__proto__' || k === 'constructor' || k === 'prototype';

/** Read a dot-path value from a deep object. Returns undefined for absent paths. */
export const readPath = (obj: unknown, path: string): unknown => {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (isUnsafeKey(part)) return undefined;
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

/**
 * Set a dot-path value on a deep object, creating intermediate
 * objects as needed. Mutates in place. Used by the pull side to
 * build a partial SystemSettings patch from the row's flat fields.
 */
export const writePath = (obj: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.');
  if (parts.some(isUnsafeKey)) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = cur[k];
    if (next === undefined || next === null || typeof next !== 'object') {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
};

/**
 * Unpacked settings patch returned by the adapter. The replica
 * orchestrator constraint (`extends ReplicaLocalRecord`) requires
 * a `name`; we set a stable placeholder so the orchestrator's
 * displayName fallback works without touching the user-visible
 * SystemSettings shape.
 */
export interface SettingsRemoteRecord {
  name: 'singleton';
  patch: Partial<SystemSettings>;
  /**
   * Per-field cipher fingerprint of the last-decrypted pull. Populated
   * from localStorage by the settings pull config so the orchestrator's
   * cipher-fingerprint heuristic can decide whether to prompt — same
   * pattern as OPDSCatalog.lastSeenCipher, just stored externally
   * since the singleton settings row has no per-record local object.
   */
  lastSeenCipher?: Record<string, string>;
}

const unwrapSettingsFields = (fields: FieldsObject): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const path of SETTINGS_WHITELIST) {
    const v = unwrap(fields[path]);
    if (v !== undefined) out[path] = v;
  }
  return out;
};

export const settingsAdapter: ReplicaAdapter<SettingsRemoteRecord> = {
  kind: SETTINGS_KIND,
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  encryptedFields: SETTINGS_ENCRYPTED_FIELDS,

  pack(record: SettingsRemoteRecord): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const path of SETTINGS_WHITELIST) {
      const value = readPath(record.patch, path);
      if (value !== undefined) fields[path] = value;
    }
    return fields;
  },

  unpack(fields: Record<string, unknown>): SettingsRemoteRecord {
    const patch: Record<string, unknown> = {};
    for (const path of SETTINGS_WHITELIST) {
      const v = fields[path];
      if (v !== undefined) writePath(patch, path, v);
    }
    return { name: 'singleton', patch: patch as Partial<SystemSettings> };
  },

  async computeId(): Promise<string> {
    return SETTINGS_REPLICA_ID;
  },

  unpackRow(row: ReplicaRow): SettingsRemoteRecord | null {
    const flat = unwrapSettingsFields(row.fields_jsonb);
    if (Object.keys(flat).length === 0) {
      // Empty row (no whitelisted fields present yet) — nothing to apply.
      return null;
    }
    const patch: Record<string, unknown> = {};
    for (const [path, v] of Object.entries(flat)) {
      writePath(patch, path, v);
    }
    return { name: 'singleton', patch: patch as Partial<SystemSettings> };
  },

  // No `binary` capability — settings is metadata-only.
};
