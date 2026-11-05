import type { EnvConfigType } from '@/services/environment';
import type { ABSServer } from '@/types/audiobookshelf';
import type { OPDSCatalog } from '@/types/opds';
import type { KOSyncStrategy, SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';
import { getAPIBaseUrl, isTauriAppPlatform } from '@/services/environment';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import { BookOrbitClient } from '@/services/bookorbit/BookOrbitClient';
import { GrimmoryClient } from '@/services/grimmory/GrimmoryClient';
import {
  createHardcoverTokenStore,
  HardcoverClient,
  HardcoverSyncMapStore,
  isHardcoverConnected,
} from '@/services/hardcover';
import { isLocalSendEnabled } from '@/services/localsend/devicePrefs';
import { NotionClient } from '@/services/notion';
import { checkCatalogFeed } from '@/services/opds/feedChecker';
import { PageboundClient, type PageboundSession } from '@/services/pagebound';
import { ReadwiseClient } from '@/services/readwise';
import { isInboxDrainEnabled } from '@/services/send/devicePrefs';
import { checkFileSyncBackend } from '@/services/sync/file/providerRegistry';
import { getReadyFileSyncBackends } from '@/services/sync/file/runLibrarySync';
import {
  cloudProviderDisplayName,
  isReadestCloudEnabled,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { KOSyncClient } from '@/services/sync/KOSyncClient';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { SyncClient } from '@/libs/sync';
import { useLocalSendStore } from '@/store/localsendStore';
import { useSettingsStore } from '@/store/settingsStore';
import { fetchWithAuth } from '@/utils/fetch';
import { stubTranslation as _ } from '@/utils/misc';
import { recordConnectionCheck } from './log';
import type { ConnectionCheck, ConnectorId, FlowKind } from './types';

/**
 * One integration seen from Readest's reading data: what it brings in
 * (`sources`), what it takes out (`sinks`) and how to ask whether it answers.
 * This describes an integration, it doesn't run it: each keeps its own sync
 * path and reports through `recordFlow`.
 */
export interface FlowConnector {
  id: ConnectorId;
  /** Translation key. */
  title: string;
  sources: FlowKind[];
  sinks: FlowKind[];
  /** Must be read-only: it runs whenever the data flow page opens. */
  check: () => Promise<ConnectionCheck>;
}

export interface ConnectorContext {
  settings: SystemSettings;
  signedIn: boolean;
  plan?: UserPlan;
  envConfig: EnvConfigType;
  absServers: ABSServer[];
  opdsCatalogs: OPDSCatalog[];
}

const byStrategy = (strategy: KOSyncStrategy | undefined, kinds: FlowKind[]) => ({
  sources: strategy === 'send' ? [] : kinds,
  sinks: strategy === 'receive' ? [] : kinds,
});

const fromResult = ({ success, message }: { success: boolean; message?: string }) => ({
  ok: success,
  message,
});

const fromToken = ({ valid, isNetworkError }: { valid: boolean; isNetworkError?: boolean }) => ({
  ok: valid,
  message: valid ? undefined : isNetworkError ? _('Server unreachable') : _('Sign-in expired'),
});

const passes = (ok: boolean) => ({ ok, message: ok ? undefined : _('Server unreachable') });

const readingConnectors = ({ settings, envConfig }: ConnectorContext): FlowConnector[] => {
  const connectors: FlowConnector[] = [];
  const { kosync, bookorbit, grimmory, readwise, hardcover, pagebound, notion, obsidian } =
    settings;

  if (kosync?.enabled && kosync.username) {
    connectors.push({
      id: 'kosync',
      title: _('KOReader'),
      ...byStrategy(kosync.strategy, ['progress']),
      check: async () => fromResult(await new KOSyncClient({ ...kosync }).checkConnection()),
    });
  }
  if (bookorbit?.enabled) {
    const progress = bookorbit.syncProgress ? byStrategy(bookorbit.strategy, ['progress']) : null;
    const notes: FlowKind[] = bookorbit.syncNotes ? ['notes'] : [];
    connectors.push({
      id: 'bookorbit',
      title: _('BookOrbit'),
      sources: [...(progress?.sources ?? []), ...notes],
      sinks: [...(progress?.sinks ?? []), ...notes],
      check: async () => fromResult(await new BookOrbitClient(bookorbit).connect()),
    });
  }
  if (grimmory?.enabled && grimmory.serverUrl && grimmory.username && grimmory.password) {
    const progress = grimmory.syncProgress ? byStrategy(grimmory.strategy, ['progress']) : null;
    const notes: FlowKind[] = grimmory.syncNotes ? ['notes'] : [];
    connectors.push({
      id: 'grimmory',
      title: _('Grimmory'),
      sources: [...(progress?.sources ?? []), ...notes],
      sinks: [...(progress?.sinks ?? []), ...notes],
      check: async () => fromResult(await new GrimmoryClient(grimmory).checkConnection()),
    });
  }
  if (readwise?.enabled && readwise.accessToken) {
    connectors.push({
      id: 'readwise',
      title: _('Readwise'),
      sources: [],
      sinks: ['notes'],
      check: async () => fromToken(await new ReadwiseClient(readwise).validateToken()),
    });
  }
  if (hardcover?.enabled && isHardcoverConnected(hardcover)) {
    connectors.push({
      id: 'hardcover',
      title: _('Hardcover'),
      sources: [],
      sinks: ['progress', 'notes'],
      check: async () => {
        const mapStore = new HardcoverSyncMapStore(await envConfig.getAppService());
        const tokens = createHardcoverTokenStore(envConfig);
        await new HardcoverClient(hardcover, mapStore, tokens).checkConnection();
        return { ok: true };
      },
    });
  }
  if (isTauriAppPlatform() && pagebound?.enabled && pagebound.refreshToken) {
    connectors.push({
      id: 'pagebound',
      title: _('Pagebound'),
      sources: [],
      sinks: ['progress'],
      check: async () => {
        await new PageboundClient(pagebound, async (session: PageboundSession) => {
          const store = useSettingsStore.getState();
          const current = store.settings.pagebound;
          // Same guard as a push: skip a renewal the user signed out of meanwhile.
          if (!current?.enabled || current.refreshToken !== pagebound.refreshToken) return;
          const next = { ...store.settings, pagebound: { ...current, ...session } };
          store.setSettings(next);
          await store.saveSettings(envConfig, next);
        }).checkConnection();
        return { ok: true };
      },
    });
  }
  if (notion?.enabled && notion.accessToken && notion.databaseId) {
    connectors.push({
      id: 'notion',
      title: _('Notion'),
      sources: [],
      sinks: ['notes'],
      check: async () => fromToken(await new NotionClient(notion).validateToken()),
    });
  }
  if (obsidian?.enabled && obsidian.folder) {
    connectors.push({
      id: 'obsidian',
      title: _('Obsidian'),
      sources: [],
      sinks: ['notes'],
      check: async () => {
        const appService = await envConfig.getAppService();
        const ok = await appService.isDirectory(obsidian.folder, 'None');
        return { ok, message: ok ? undefined : _('Folder not available') };
      },
    });
  }
  return connectors;
};

const cloudConnectors = ({ settings, signedIn, plan }: ConnectorContext): FlowConnector[] => {
  const connectors: FlowConnector[] = [];
  if (signedIn && isReadestCloudEnabled(settings)) {
    const kinds: FlowKind[] = [
      ...(isSyncCategoryEnabled('configs') ? (['progress'] as const) : []),
      ...(isSyncCategoryEnabled('notes') ? (['notes'] as const) : []),
      ...(isSyncCategoryEnabled('books') ? (['books'] as const) : []),
    ];
    connectors.push({
      id: 'readest-cloud',
      title: _('Readest Cloud'),
      sources: kinds,
      sinks: kinds,
      // Asks for changes from now on: there are none, so nothing is transferred.
      check: async () => {
        await new SyncClient().pullChanges(Date.now(), 'books', undefined, undefined, 1);
        return { ok: true };
      },
    });
  }
  for (const kind of getReadyFileSyncBackends(settings, plan)) {
    const slice = settings[settingsKeyForBackend(kind)];
    const kinds: FlowKind[] = [
      ...((slice?.syncProgress ?? true) ? (['progress'] as const) : []),
      ...((slice?.syncNotes ?? true) ? (['notes'] as const) : []),
      ...((slice?.syncBooks ?? false) ? (['books'] as const) : []),
    ];
    connectors.push({
      id: kind,
      title: cloudProviderDisplayName(kind),
      ...byStrategy(slice?.strategy, kinds),
      check: async () => passes(await checkFileSyncBackend(kind, settings)),
    });
  }
  return connectors;
};

const contentConnectors = (ctx: ConnectorContext): FlowConnector[] => {
  const connectors: FlowConnector[] = [];
  const servers = ctx.absServers.filter((server) => !server.deletedAt && !server.disabled);
  if (servers.length > 0) {
    connectors.push({
      id: 'audiobookshelf',
      title: _('Audiobookshelf'),
      sources: ['books', 'progress'],
      sinks: ['progress'],
      check: async () => {
        const appService = await ctx.envConfig.getAppService();
        await Promise.all(servers.map((server) => createAbsClient(appService, server).getMe()));
        return { ok: true };
      },
    });
  }
  const catalogs = ctx.opdsCatalogs.filter((catalog) => !catalog.deletedAt && !catalog.disabled);
  if (catalogs.length > 0) {
    connectors.push({
      id: 'opds',
      title: _('OPDS Catalogs'),
      sources: ['books'],
      sinks: [],
      check: async () => passes((await Promise.all(catalogs.map(checkCatalogFeed))).every(Boolean)),
    });
  }
  if (ctx.signedIn && isInboxDrainEnabled()) {
    connectors.push({
      id: 'send',
      title: _('Send to Readest'),
      sources: ['books'],
      sinks: [],
      // Lists the inbox rather than calling /send/inbox/claim: a claim leases
      // the oldest item and can't be handed back. The drainer reports real claims.
      check: async () => {
        await fetchWithAuth(`${getAPIBaseUrl()}/send/inbox`, { method: 'GET' });
        return { ok: true };
      },
    });
  }
  if (isTauriAppPlatform() && isLocalSendEnabled()) {
    connectors.push({
      id: 'localsend',
      title: _('Nearby BookDrop'),
      sources: ['books'],
      sinks: ['books'],
      check: async () => ({
        ok: !!useLocalSendStore.getState().status?.running,
        message: useLocalSendStore.getState().status?.running ? undefined : _('Not running'),
      }),
    });
  }
  return connectors;
};

/** Every integration set up on this device with something to carry. */
export const getFlowConnectors = (ctx: ConnectorContext): FlowConnector[] =>
  [...readingConnectors(ctx), ...cloudConnectors(ctx), ...contentConnectors(ctx)].filter(
    (connector) => connector.sources.length > 0 || connector.sinks.length > 0,
  );

export const runConnectionCheck = async (connector: FlowConnector) => {
  try {
    recordConnectionCheck(connector.id, await connector.check());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordConnectionCheck(connector.id, { ok: false, message });
  }
};
