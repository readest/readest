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
    if (row.reincarnation) catalog.reincarnation = row.reincarnation;
    return catalog;
  },

  // No `binary` capability — opds_catalog is metadata-only.
};
