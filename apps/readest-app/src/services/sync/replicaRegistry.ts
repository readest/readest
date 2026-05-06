import type { BaseDir, FileSystem } from '@/types/system';

export interface BinaryCapability<T> {
  localBaseDir: BaseDir;
  enumerateFiles(replica: T): { logical: string; lfp: string; byteSize: number }[];
}

export interface LifecycleHooks<T> {
  postDownload?(replica: T, fs: FileSystem): Promise<void>;
  validateOnLoad?(replica: T, fs: FileSystem): Promise<{ unavailable?: boolean }>;
}

export interface ReplicaAdapter<T = unknown> {
  kind: string;
  schemaVersion: number;
  pack(replica: T): Record<string, unknown>;
  unpack(fields: Record<string, unknown>): T;
  computeId(input: T): Promise<string>;
  binary?: BinaryCapability<T>;
  lifecycle?: LifecycleHooks<T>;
}

const registry = new Map<string, ReplicaAdapter<unknown>>();

export const registerReplicaAdapter = <T>(adapter: ReplicaAdapter<T>): void => {
  if (registry.has(adapter.kind)) {
    throw new Error(`Replica adapter for kind="${adapter.kind}" is already registered`);
  }
  registry.set(adapter.kind, adapter as ReplicaAdapter<unknown>);
};

export const getReplicaAdapter = <T = unknown>(kind: string): ReplicaAdapter<T> | undefined =>
  registry.get(kind) as ReplicaAdapter<T> | undefined;

export const listReplicaAdapters = (): ReplicaAdapter<unknown>[] => Array.from(registry.values());

export const clearReplicaAdapters = (): void => {
  registry.clear();
};
