import { md5 } from '@/utils/md5';
import type { OPDSCatalog } from '@/types/opds';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { FieldsObject, ReplicaRow } from '@/types/replica';
import { defaultComputeId, unwrap } from './helpers';

export const OPDS_CATALOG_KIND = 'opds_catalog';
export const OPDS_CATALOG_SCHEMA_VERSION = 1;

interface UnwrappedOpdsFields {
  name?: string;
  url?: string;
  description?: string;
  icon?: string;
  customHeaders?: Record<string, string>;
  autoDownload?: boolean;
  disabled?: boolean;
  addedAt?: number;
  username?: string;
  password?: string;
}

const unwrapOpdsFields = (fields: FieldsObject): UnwrappedOpdsFields => {
  const name = unwrap(fields['name']);
  const url = unwrap(fields['url']);
  const description = unwrap(fields['description']);
  const icon = unwrap(fields['icon']);
  const customHeaders = unwrap(fields['customHeaders']);
  const autoDownload = unwrap(fields['autoDownload']);
  const disabled = unwrap(fields['disabled']);
  const addedAt = unwrap(fields['addedAt']);
  // Crypto middleware decrypted these in place before unpackRow ran
  // (see replicaCryptoMiddleware.decryptRowFields). A missing entry
  // means either the publishing device hadn't unlocked yet or the
  // local CryptoSession couldn't decrypt — local plaintext copy is
  // preserved by customOPDSStore.applyRemoteCatalog.
  const username = unwrap(fields['username']);
  const password = unwrap(fields['password']);
  return {
    name: typeof name === 'string' ? name : undefined,
    url: typeof url === 'string' ? url : undefined,
    description: typeof description === 'string' ? description : undefined,
    icon: typeof icon === 'string' ? icon : undefined,
    customHeaders:
      customHeaders && typeof customHeaders === 'object' && !Array.isArray(customHeaders)
        ? (customHeaders as Record<string, string>)
        : undefined,
    autoDownload: autoDownload === true ? true : undefined,
    disabled: disabled === true ? true : undefined,
    addedAt: typeof addedAt === 'number' ? addedAt : undefined,
    username: typeof username === 'string' ? username : undefined,
    password: typeof password === 'string' ? password : undefined,
  };
};

/**
 * Stable cross-device identity for an OPDS catalog. Two devices that import
 * the same URL converge to a single replica row instead of duplicating.
 * URL is normalized (trim + lower-case) so trailing-slash and case
 * differences don't fragment identity. Username/password are intentionally
 * excluded — encrypted-credential sync is in a follow-up PR; including
 * username here would couple identity to a field that may not yet sync.
 */
export const computeOpdsCatalogContentId = (url: string): string =>
  md5(`opds:${url.trim().toLowerCase()}`);

export const opdsCatalogAdapter: ReplicaAdapter<OPDSCatalog> = {
  kind: OPDS_CATALOG_KIND,
  schemaVersion: OPDS_CATALOG_SCHEMA_VERSION,

  pack(catalog: OPDSCatalog): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: catalog.name,
      url: catalog.url,
      addedAt: catalog.addedAt ?? Date.now(),
    };
    if (catalog.description !== undefined) fields['description'] = catalog.description;
    if (catalog.icon !== undefined) fields['icon'] = catalog.icon;
    if (catalog.customHeaders !== undefined) fields['customHeaders'] = catalog.customHeaders;
    if (catalog.autoDownload !== undefined) fields['autoDownload'] = catalog.autoDownload;
    if (catalog.disabled !== undefined) fields['disabled'] = catalog.disabled;
    // Pass credentials as plaintext here — the publish-side crypto
    // middleware (replicaCryptoMiddleware.encryptPackedFields) wraps
    // them in cipher envelopes before they hit fields_jsonb. If the
    // CryptoSession isn't unlocked, the middleware drops them
    // entirely so they don't leak as plaintext.
    if (catalog.username !== undefined) fields['username'] = catalog.username;
    if (catalog.password !== undefined) fields['password'] = catalog.password;
    return fields;
  },

  unpack(fields: Record<string, unknown>): OPDSCatalog {
    return {
      id: '',
      name: String(fields['name'] ?? ''),
      url: String(fields['url'] ?? ''),
      description: fields['description'] !== undefined ? String(fields['description']) : undefined,
      icon: fields['icon'] !== undefined ? String(fields['icon']) : undefined,
      customHeaders:
        fields['customHeaders'] && typeof fields['customHeaders'] === 'object'
          ? (fields['customHeaders'] as Record<string, string>)
          : undefined,
      autoDownload: fields['autoDownload'] === true ? true : undefined,
      disabled: fields['disabled'] === true ? true : undefined,
      addedAt: fields['addedAt'] !== undefined ? Number(fields['addedAt']) : undefined,
      username: fields['username'] !== undefined ? String(fields['username']) : undefined,
      password: fields['password'] !== undefined ? String(fields['password']) : undefined,
    };
  },

  computeId: defaultComputeId,

  unpackRow(row: ReplicaRow): OPDSCatalog | null {
    const fields = unwrapOpdsFields(row.fields_jsonb);
    if (!fields.name || !fields.url) return null;
    const catalog: OPDSCatalog = {
      // OPDS catalogs use contentId as their local id — they have no
      // "bundle dir" pointer to disambiguate, and the URL-derived
      // contentId is already a stable cross-device identifier.
      id: row.replica_id,
      contentId: row.replica_id,
      name: fields.name,
      url: fields.url,
    };
    if (fields.description !== undefined) catalog.description = fields.description;
    if (fields.icon !== undefined) catalog.icon = fields.icon;
    if (fields.customHeaders !== undefined) catalog.customHeaders = fields.customHeaders;
    if (fields.autoDownload !== undefined) catalog.autoDownload = fields.autoDownload;
    if (fields.disabled !== undefined) catalog.disabled = fields.disabled;
    if (fields.addedAt !== undefined) catalog.addedAt = fields.addedAt;
    if (fields.username !== undefined) catalog.username = fields.username;
    if (fields.password !== undefined) catalog.password = fields.password;
    if (row.reincarnation) catalog.reincarnation = row.reincarnation;
    return catalog;
  },

  // Plaintext slot here; the publish/pull middleware handles the
  // crypto round trip. Adapters never see ciphertext.
  encryptedFields: ['username', 'password'] as const,

  // No `binary` capability — opds_catalog is metadata-only.
};
