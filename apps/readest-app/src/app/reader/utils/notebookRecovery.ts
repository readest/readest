import { md5 } from '@/utils/md5';

export const NOTEBOOK_RECOVERY_VERSION = 1;
const NOTEBOOK_RECOVERY_PREFIX = 'readest:notebook-recovery';

export interface NotebookRecoveryEntry {
  version: typeof NOTEBOOK_RECOVERY_VERSION;
  content: string;
  baseHash: string;
  baseUpdatedAt: number | null;
  revision: number;
}

export type NotebookRecoveryResolution =
  | { kind: 'none' }
  | { kind: 'restore'; content: string }
  | { kind: 'diverged'; durableContent: string; recoveryContent: string };

interface CreateNotebookRecoveryEntryOptions {
  content: string;
  baseContent: string;
  baseUpdatedAt: number | null;
  revision: number;
}

export const getNotebookContentHash = (content: string): string => md5(content);

export const getNotebookRecoveryKey = (profileId: string, bookHash: string): string =>
  `${NOTEBOOK_RECOVERY_PREFIX}:${encodeURIComponent(profileId)}:${bookHash}`;

export const createNotebookRecoveryEntry = ({
  content,
  baseContent,
  baseUpdatedAt,
  revision,
}: CreateNotebookRecoveryEntryOptions): NotebookRecoveryEntry => ({
  version: NOTEBOOK_RECOVERY_VERSION,
  content,
  baseHash: getNotebookContentHash(baseContent),
  baseUpdatedAt,
  revision,
});

const isNotebookRecoveryEntry = (value: unknown): value is NotebookRecoveryEntry => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['version'] === NOTEBOOK_RECOVERY_VERSION &&
    typeof candidate['content'] === 'string' &&
    typeof candidate['baseHash'] === 'string' &&
    (typeof candidate['baseUpdatedAt'] === 'number' || candidate['baseUpdatedAt'] === null) &&
    Number.isInteger(candidate['revision']) &&
    Number(candidate['revision']) >= 0
  );
};

export const readNotebookRecovery = (
  storage: Storage,
  key: string,
): NotebookRecoveryEntry | null => {
  try {
    const stored = storage.getItem(key);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isNotebookRecoveryEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeNotebookRecovery = (
  storage: Storage,
  key: string,
  entry: NotebookRecoveryEntry,
): boolean => {
  try {
    storage.setItem(key, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
};

export const clearNotebookRecovery = (storage: Storage, key: string): boolean => {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const resolveNotebookRecovery = (
  durableContent: string,
  durableUpdatedAt: number | null,
  recovery: NotebookRecoveryEntry,
): NotebookRecoveryResolution => {
  if (recovery.content === durableContent) return { kind: 'none' };
  const durableMatchesBase =
    recovery.baseUpdatedAt === durableUpdatedAt &&
    recovery.baseHash === getNotebookContentHash(durableContent);
  if (durableMatchesBase) return { kind: 'restore', content: recovery.content };
  return {
    kind: 'diverged',
    durableContent,
    recoveryContent: recovery.content,
  };
};
