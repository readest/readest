import { useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { getFlowConnectors } from '@/services/sync/dataFlow/connectors';
import { readFlowState, subscribeFlowState } from '@/services/sync/dataFlow/log';
import { useABSServerStore } from '@/store/absServerStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';

export const useFlowConnectors = () => {
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const { userProfilePlan } = useQuotaStats();
  const absServers = useABSServerStore((s) => s.servers);
  const opdsCatalogs = useCustomOPDSStore((s) => s.catalogs);
  return useMemo(
    () =>
      getFlowConnectors({
        settings,
        signedIn: !!user,
        plan: userProfilePlan,
        envConfig,
        absServers,
        opdsCatalogs,
      }),
    [settings, user, userProfilePlan, envConfig, absServers, opdsCatalogs],
  );
};

export const useFlowState = () =>
  useSyncExternalStore(subscribeFlowState, readFlowState, readFlowState);
