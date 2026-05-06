'use client';

import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { EnvConfigType } from '../services/environment';
import { AppService } from '@/types/system';
import env from '../services/environment';
import { bootstrapReplicaAdapters } from '@/services/sync/replicaBootstrap';
import { initReplicaSync } from '@/services/sync/replicaSync';
import { createSettingsCursorStore } from '@/services/sync/replicaCursorStore';
import { startReplicaTransferIntegration } from '@/services/sync/replicaTransferIntegration';
import { pullDictionariesAndApply } from '@/services/sync/replicaPullDictionaries';
import { useCustomDictionaryStore, enableReplicaAutoPersist } from '@/store/customDictionaryStore';
import { transferManager } from '@/services/transferManager';
import { getAccessToken } from '@/utils/access';
import { uniqueId } from '@/utils/misc';
import type { ReplicaSyncManager } from '@/services/sync/replicaSyncManager';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { ReplicaTransferFile } from '@/store/transferStore';
import type { BaseDir } from '@/types/system';

interface EnvContextType {
  envConfig: EnvConfigType;
  appService: AppService | null;
}

const EnvContext = createContext<EnvContextType | undefined>(undefined);

const buildDictionaryPullDeps = (manager: ReplicaSyncManager, service: AppService) => ({
  // Boot path uses since=null so we always re-fetch and apply locally,
  // ignoring any previously-advanced cursor. Periodic sync (visibility /
  // online) goes through manager.pull(kind) which keeps using the cursor.
  pull: () => manager.pull('dictionary', { since: null }),
  findByContentId: (id: string) => useCustomDictionaryStore.getState().findByContentId(id),
  applyRemoteDictionary: (dict: ImportedDictionary) =>
    useCustomDictionaryStore.getState().applyRemoteDictionary(dict),
  softDeleteByContentId: (id: string) =>
    useCustomDictionaryStore.getState().softDeleteByContentId(id),
  createBundleDir: async () => {
    const id = uniqueId();
    await service.createDir(id, 'Dictionaries', true);
    return id;
  },
  queueReplicaDownload: (
    contentId: string,
    displayTitle: string,
    files: ReplicaTransferFile[],
    _bundleDir: string,
    base: BaseDir,
  ) => transferManager.queueReplicaDownload('dictionary', contentId, displayTitle, files, base),
  isAuthenticated: async () => !!(await getAccessToken()),
});

export const EnvProvider = ({ children }: { children: ReactNode }) => {
  const [envConfig] = useState<EnvConfigType>(env);
  const [appService, setAppService] = useState<AppService | null>(null);

  React.useEffect(() => {
    bootstrapReplicaAdapters();
    // Replica-side dict mutators (applyRemoteDictionary, etc.) need to
    // persist into settings so the next loadCustomDictionaries doesn't
    // wipe them — register the envConfig once.
    enableReplicaAutoPersist(envConfig);
    envConfig.getAppService().then(async (service) => {
      setAppService(service);
      try {
        const settings = await service.loadSettings();
        if (settings.replicaDeviceId) {
          const ctx = initReplicaSync({
            deviceId: settings.replicaDeviceId,
            cursorStore: createSettingsCursorStore(service),
          });
          ctx.manager.startAutoSync();
          startReplicaTransferIntegration(service);
          // Pull-side: fetch dictionary rows pushed from other devices
          // and apply them locally (placeholder + queued download). Best-
          // effort — failures don't block the rest of app boot.
          //
          // Defer the pull until TransferManager is initialized (which
          // happens after library load via useTransferQueue). Otherwise
          // queueReplicaDownload no-ops and the dict appears in the list
          // without its binaries.
          const deps = buildDictionaryPullDeps(ctx.manager, service);
          console.log('[replica] EnvContext: awaiting transferManager.waitUntilReady before pull');
          void transferManager
            .waitUntilReady()
            .then(() => {
              console.log('[replica] EnvContext: transferManager ready, invoking pull');
              return pullDictionariesAndApply(deps);
            })
            .catch((err) => console.warn('replica dictionary pull failed', err));
        }
      } catch (err) {
        console.warn('replica sync init failed', err);
      }
    });
    window.addEventListener('error', (e) => {
      if (e.message === 'ResizeObserver loop limit exceeded') {
        e.stopImmediatePropagation();
        e.preventDefault();
        return true;
      }
      return false;
    });
  }, [envConfig]);

  const value = useMemo(() => ({ envConfig, appService }), [envConfig, appService]);
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
};

export const useEnv = (): EnvContextType => {
  const context = useContext(EnvContext);
  if (!context) throw new Error('useEnv must be used within EnvProvider');
  return context;
};
