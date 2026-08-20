import { md5 } from '@/utils/md5';
import type { ABSServer } from '@/types/audiobookshelf';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { FieldsObject, ReplicaRow } from '@/types/replica';
import { defaultComputeId, unwrap } from './helpers';

export const ABS_SERVER_KIND = 'abs_server';
export const ABS_SERVER_SCHEMA_VERSION = 1;

/** Stable cross-device identity; normalized like computeOpdsCatalogContentId. */
export const computeAbsServerContentId = (url: string): string =>
  md5(`abs:${url.trim().toLowerCase()}`);

interface UnwrappedAbsFields {
  name?: string;
  url?: string;
  addedAt?: number;
  libraryIds?: string[];
  disabled?: boolean;
  serverVersion?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
}

const unwrapAbsFields = (fields: FieldsObject): UnwrappedAbsFields => {
  const name = unwrap(fields['name']);
  const url = unwrap(fields['url']);
  const addedAt = unwrap(fields['addedAt']);
  const libraryIds = unwrap(fields['libraryIds']);
  const disabled = unwrap(fields['disabled']);
  const serverVersion = unwrap(fields['serverVersion']);
  // Crypto middleware decrypted these in place before unpackRow ran
  // (see replicaCryptoMiddleware.decryptRowFields). A missing entry
  // means either the publishing device hadn't unlocked yet or the
  // local CryptoSession couldn't decrypt — local plaintext copy is
  // preserved by absServerStore.applyRemoteServer.
  const username = unwrap(fields['username']);
  const password = unwrap(fields['password']);
  const accessToken = unwrap(fields['accessToken']);
  const refreshToken = unwrap(fields['refreshToken']);
  return {
    name: typeof name === 'string' ? name : undefined,
    url: typeof url === 'string' ? url : undefined,
    addedAt: typeof addedAt === 'number' ? addedAt : undefined,
    libraryIds:
      Array.isArray(libraryIds) && libraryIds.every((id) => typeof id === 'string')
        ? (libraryIds as string[])
        : undefined,
    disabled: disabled === true ? true : undefined,
    serverVersion: typeof serverVersion === 'string' ? serverVersion : undefined,
    username: typeof username === 'string' ? username : undefined,
    password: typeof password === 'string' ? password : undefined,
    accessToken: typeof accessToken === 'string' ? accessToken : undefined,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
  };
};

export const absServerAdapter: ReplicaAdapter<ABSServer> = {
  kind: ABS_SERVER_KIND,
  schemaVersion: ABS_SERVER_SCHEMA_VERSION,

  pack(server: ABSServer): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: server.name,
      url: server.url,
      addedAt: server.addedAt ?? Date.now(),
    };
    if (server.libraryIds !== undefined) fields['libraryIds'] = server.libraryIds;
    if (server.disabled !== undefined) fields['disabled'] = server.disabled;
    if (server.serverVersion !== undefined) fields['serverVersion'] = server.serverVersion;
    // Pass credentials as plaintext here — the publish-side crypto
    // middleware (replicaCryptoMiddleware.encryptPackedFields) wraps
    // them in cipher envelopes before they hit fields_jsonb. If the
    // CryptoSession isn't unlocked, the middleware drops them
    // entirely so they don't leak as plaintext.
    if (server.username !== undefined) fields['username'] = server.username;
    if (server.password !== undefined) fields['password'] = server.password;
    if (server.accessToken !== undefined) fields['accessToken'] = server.accessToken;
    if (server.refreshToken !== undefined) fields['refreshToken'] = server.refreshToken;
    return fields;
  },

  unpack(fields: Record<string, unknown>): ABSServer {
    const libraryIds = fields['libraryIds'];
    return {
      id: '',
      name: String(fields['name'] ?? ''),
      url: String(fields['url'] ?? ''),
      addedAt: fields['addedAt'] !== undefined ? Number(fields['addedAt']) : undefined,
      libraryIds:
        Array.isArray(libraryIds) && libraryIds.every((id) => typeof id === 'string')
          ? (libraryIds as string[])
          : undefined,
      disabled: fields['disabled'] === true ? true : undefined,
      serverVersion:
        fields['serverVersion'] !== undefined ? String(fields['serverVersion']) : undefined,
      username: fields['username'] !== undefined ? String(fields['username']) : undefined,
      password: fields['password'] !== undefined ? String(fields['password']) : undefined,
      accessToken: fields['accessToken'] !== undefined ? String(fields['accessToken']) : undefined,
      refreshToken:
        fields['refreshToken'] !== undefined ? String(fields['refreshToken']) : undefined,
    };
  },

  computeId: defaultComputeId,

  unpackRow(row: ReplicaRow): ABSServer | null {
    const fields = unwrapAbsFields(row.fields_jsonb);
    if (!fields.name || !fields.url) return null;
    const server: ABSServer = {
      // ABS servers use contentId as their local id — they have no
      // "bundle dir" pointer to disambiguate, and the URL-derived
      // contentId is already a stable cross-device identifier.
      id: row.replica_id,
      contentId: row.replica_id,
      name: fields.name,
      url: fields.url,
    };
    if (fields.addedAt !== undefined) server.addedAt = fields.addedAt;
    if (fields.libraryIds !== undefined) server.libraryIds = fields.libraryIds;
    if (fields.disabled !== undefined) server.disabled = fields.disabled;
    if (fields.serverVersion !== undefined) server.serverVersion = fields.serverVersion;
    if (fields.username !== undefined) server.username = fields.username;
    if (fields.password !== undefined) server.password = fields.password;
    if (fields.accessToken !== undefined) server.accessToken = fields.accessToken;
    if (fields.refreshToken !== undefined) server.refreshToken = fields.refreshToken;
    if (row.reincarnation) server.reincarnation = row.reincarnation;
    return server;
  },

  // Plaintext slot here; the publish/pull middleware handles the
  // crypto round trip. Adapters never see ciphertext.
  encryptedFields: ['username', 'password', 'accessToken', 'refreshToken'] as const,

  // No `binary` capability — abs_server is metadata-only.
};
