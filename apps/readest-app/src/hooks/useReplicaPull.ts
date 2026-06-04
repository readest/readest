export type ReplicaKind = 'dictionary' | 'font' | 'texture' | 'opds_catalog' | 'settings';

export interface UseReplicaPullOpts {
  kinds: readonly ReplicaKind[];
  delayMs?: number;
}

/**
 * Cross-device replica sync is disabled in the local-only Android build.
 */
export const useReplicaPull = (_opts: UseReplicaPullOpts): void => {};

export const __resetReplicaPullForTests = (): void => {};
