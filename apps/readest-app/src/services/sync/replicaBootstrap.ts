import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { dictionaryAdapter, DICTIONARY_KIND } from './adapters/dictionary';
import { getReplicaAdapter, registerReplicaAdapter } from './replicaRegistry';
import { registerReplicaDownloadHandler } from './replicaTransferIntegration';
import type { ReplicaAdapter } from './replicaRegistry';

const KNOWN_ADAPTERS: ReplicaAdapter<unknown>[] = [
  dictionaryAdapter as unknown as ReplicaAdapter<unknown>,
];

let didBootstrap = false;

export const bootstrapReplicaAdapters = (): void => {
  if (didBootstrap) return;
  for (const adapter of KNOWN_ADAPTERS) {
    if (getReplicaAdapter(adapter.kind)) continue;
    registerReplicaAdapter(adapter);
  }
  // Per-kind download-completion handlers — fired by
  // replicaTransferIntegration once binaries are on disk. Each store
  // exposes a markAvailable* method that clears the placeholder
  // `unavailable` flag set by the pull orchestrator.
  registerReplicaDownloadHandler(DICTIONARY_KIND, (replicaId) => {
    useCustomDictionaryStore.getState().markAvailableByContentId(replicaId);
  });
  didBootstrap = true;
};

export const __resetBootstrapForTests = (): void => {
  didBootstrap = false;
};
