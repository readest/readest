import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { dictionaryAdapter, DICTIONARY_KIND } from './adapters/dictionary';
import { fontAdapter, FONT_KIND } from './adapters/font';
import { getReplicaPersistEnv } from './replicaPersist';
import { getReplicaAdapter, registerReplicaAdapter } from './replicaRegistry';
import { registerReplicaDownloadHandler } from './replicaTransferIntegration';
import type { ReplicaAdapter } from './replicaRegistry';

const KNOWN_ADAPTERS: ReplicaAdapter<unknown>[] = [
  dictionaryAdapter as unknown as ReplicaAdapter<unknown>,
  fontAdapter as unknown as ReplicaAdapter<unknown>,
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
  // Fonts need more than the unavailable flag cleared: the binary must
  // be loaded into a blob URL and the @font-face rule injected, the
  // same plumbing manual import does in CustomFonts.tsx. Without this
  // the auto-downloaded font appears in the UI but renders in a
  // fallback face. Falls back to flag-only when persist env hasn't
  // landed yet (extremely early boot).
  registerReplicaDownloadHandler(FONT_KIND, (replicaId) => {
    const env = getReplicaPersistEnv();
    if (!env) {
      useCustomFontStore.getState().markAvailableByContentId(replicaId);
      return;
    }
    void useCustomFontStore.getState().activateFontByContentId(env, replicaId);
  });
  didBootstrap = true;
};

export const __resetBootstrapForTests = (): void => {
  didBootstrap = false;
};
