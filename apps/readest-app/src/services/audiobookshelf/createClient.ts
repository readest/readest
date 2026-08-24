import { ABSClient } from '@/services/audiobookshelf/client';
import { useABSServerStore } from '@/store/absServerStore';
import type { AppService } from '@/types/system';
import type { ABSServer } from '@/types/audiobookshelf';
import type { EnvConfigType } from '@/services/environment';

const toEnvConfig = (appService: AppService): EnvConfigType => ({
  getAppService: async () => appService,
});

/**
 * An ABSClient whose token refreshes are written back to the server store
 * and persisted, so a rotated access token survives the session that
 * rotated it. Every API-calling path shares this; cover-only downloads
 * (unauthenticated) don't need it.
 */
export const createAbsClient = (appService: AppService, server: ABSServer): ABSClient =>
  new ABSClient(server, {
    onTokensUpdated: (patch) => {
      useABSServerStore.getState().updateServer(server.id, patch);
      void useABSServerStore.getState().saveABSServers(toEnvConfig(appService));
    },
  });
