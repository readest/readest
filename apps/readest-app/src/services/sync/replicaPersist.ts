import type { EnvConfigType } from '@/services/environment';

/**
 * Replica-side mutators (applyRemote*, softDelete*, markAvailable*)
 * fire from the boot-time pull / download-complete handlers, NOT the
 * settings UI. UI mutators couple their state writes with an explicit
 * saveCustomX(envConfig) call; the replica path has no such pairing,
 * so without auto-persist the next loadCustomX would read stale
 * settings and wipe the in-memory rows.
 *
 * EnvProvider registers envConfig once at boot; every replica-aware
 * store reads it via getReplicaPersistEnv() inside its replica-side
 * mutators and fire-and-forget saves through it.
 */
let replicaPersistEnv: EnvConfigType | null = null;

export const enableReplicaAutoPersist = (envConfig: EnvConfigType | null): void => {
  replicaPersistEnv = envConfig;
};

export const getReplicaPersistEnv = (): EnvConfigType | null => replicaPersistEnv;
