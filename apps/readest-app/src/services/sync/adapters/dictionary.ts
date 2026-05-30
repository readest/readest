import { md5 } from '@/utils/md5';
import { buildLocalDictFromRow } from '@/services/sync/replicaDictionaryApply';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { ReplicaRow } from '@/types/replica';

export const DICTIONARY_KIND = 'dictionary';
export const DICTIONARY_SCHEMA_VERSION = 1;

export interface DictionarySyncedFields {
  name: string;
  kind: ImportedDictionary['kind'];
  lang?: string;
  addedAt: number;
  unsupported?: boolean;
  unsupportedReason?: string;
}

export const primaryDictionaryFile = (d: ImportedDictionary): string | null => {
  switch (d.kind) {
    case 'mdict':
      return d.files.mdx ?? null;
    case 'stardict':
      return d.files.ifo ?? null;
    case 'dict':
      return d.files.dict ?? null;
    case 'slob':
      return d.files.slob ?? null;
    default:
      return null;
  }
};

export const enumerateDictionaryFiles = (
  d: ImportedDictionary,
): { logical: string; lfp: string; byteSize: number }[] => {
  const out: { logical: string; lfp: string; byteSize: number }[] = [];
  const push = (filename?: string) => {
    if (!filename) return;
    out.push({
      logical: filename,
      lfp: `${d.bundleDir}/${filename}`,
      byteSize: 0,
    });
  };
  switch (d.kind) {
    case 'mdict':
      push(d.files.mdx);
      d.files.mdd?.forEach(push);
      d.files.css?.forEach(push);
      break;
    case 'stardict':
      push(d.files.ifo);
      push(d.files.idx);
      push(d.files.dict);
      push(d.files.syn);
      break;
    case 'dict':
      push(d.files.dict);
      push(d.files.index);
      break;
    case 'slob':
      push(d.files.slob);
      break;
  }
  return out;
};

export const computeDictionaryReplicaId = (
  partialMd5: string,
  byteSize: number,
  filenames: string[],
): string => {
  const sortedFilenames = [...filenames].sort();
  return md5(`${partialMd5}|${byteSize}|${sortedFilenames.join(',')}`);
};

export const dictionaryAdapter: ReplicaAdapter<ImportedDictionary> = {
  kind: DICTIONARY_KIND,
  schemaVersion: DICTIONARY_SCHEMA_VERSION,

  pack(d: ImportedDictionary): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: d.name,
      kind: d.kind,
      addedAt: d.addedAt,
    };
    if (d.lang !== undefined) fields['lang'] = d.lang;
    if (d.unsupported) fields['unsupported'] = true;
    if (d.unsupportedReason) fields['unsupportedReason'] = d.unsupportedReason;
    return fields;
  },

  unpack(fields: Record<string, unknown>): ImportedDictionary {
    return {
      id: '',
      kind: fields['kind'] as ImportedDictionary['kind'],
      name: String(fields['name'] ?? ''),
      bundleDir: '',
      files: {},
      lang: fields['lang'] !== undefined ? String(fields['lang']) : undefined,
      addedAt: Number(fields['addedAt'] ?? 0),
      unsupported: fields['unsupported'] === true ? true : undefined,
      unsupportedReason:
        fields['unsupportedReason'] !== undefined ? String(fields['unsupportedReason']) : undefined,
    };
  },

  async computeId(d: ImportedDictionary): Promise<string> {
    return d.id;
  },

  unpackRow(row: ReplicaRow, bundleDir: string): ImportedDictionary | null {
    return buildLocalDictFromRow(row, bundleDir);
  },

  binary: {
    localBaseDir: 'Dictionaries',
    enumerateFiles: enumerateDictionaryFiles,
  },
};
