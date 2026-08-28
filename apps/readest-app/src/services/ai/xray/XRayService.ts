import type { AISettings } from '@/services/ai/types';
import type { AppService } from '@/types/system';

import type { GenreMetadata } from './genre';
import {
  ReedyXRaySource,
  type XRaySourceSlice,
  type XRaySourceStatus,
} from './source/ReedyXRaySource';
import { XRayStore } from './storage/XRayStore';
import type { XRayLookupResult, XRaySnapshot } from './types';
import { XRayModelExtractor } from './XRayModelExtractor';
import { XRayPipeline, type XRayUpdateResult } from './XRayPipeline';
import { XRaySnapshotService } from './XRaySnapshotService';

export interface XRayProgressUpdate {
  readonly bookHash: string;
  readonly currentCfi: string;
  readonly metadata?: GenreMetadata;
  readonly signal?: AbortSignal;
}

export type XRayProgressUpdateResult =
  | XRayUpdateResult
  | { readonly kind: 'unavailable'; readonly status: XRaySourceStatus };

const XRAY_DERIVATION_VERSION = 1;

export class XRayService {
  private readonly pipeline: XRayPipeline;
  private readonly snapshots: XRaySnapshotService;

  private constructor(
    private readonly source: ReedyXRaySource,
    store: XRayStore,
    extractor: XRayModelExtractor,
    chatModelIdentity: string,
  ) {
    const derivedSource = {
      readThrough: async (bookHash: string, currentCfi: string) =>
        withDerivationFingerprint(
          await source.readThrough(bookHash, currentCfi),
          chatModelIdentity,
        ),
    };
    this.pipeline = new XRayPipeline(derivedSource, store, extractor);
    this.snapshots = new XRaySnapshotService(derivedSource, store);
  }

  static async open(appService: AppService, settings: AISettings): Promise<XRayService> {
    if (appService.appPlatform !== 'tauri') {
      throw new Error('X-Ray is only available in the Tauri app');
    }
    if (!settings.enabled || !settings.reedy?.enabled) {
      throw new Error('X-Ray requires AI and Reedy to be enabled');
    }
    const { createXRayModels } = await import('./source/models');
    const models = createXRayModels(settings);
    const [source, store] = await Promise.all([
      ReedyXRaySource.open(appService, models.embeddingModelId),
      XRayStore.open(appService),
    ]);
    return new XRayService(
      source,
      store,
      new XRayModelExtractor(models.chat),
      models.chatModelIdentity,
    );
  }

  getStatus(bookHash: string): Promise<XRaySourceStatus> {
    return this.source.getStatus(bookHash);
  }

  async updateForProgress(update: XRayProgressUpdate): Promise<XRayProgressUpdateResult> {
    const status = await this.source.getStatus(update.bookHash);
    if (status.kind !== 'ready') {
      return { kind: 'unavailable', status };
    }

    return this.pipeline.update(update.bookHash, update.currentCfi, {
      metadata: update.metadata,
      signal: update.signal,
    });
  }

  getSnapshot(bookHash: string, currentCfi: string): Promise<XRaySnapshot> {
    return this.snapshots.getSnapshot(bookHash, currentCfi);
  }

  lookup(
    bookHash: string,
    currentCfi: string,
    term: string,
    language: string,
  ): Promise<XRayLookupResult> {
    return this.snapshots.lookup(bookHash, currentCfi, term, language);
  }
}

const withDerivationFingerprint = (
  source: XRaySourceSlice,
  chatModelIdentity: string,
): XRaySourceSlice => ({
  ...source,
  fingerprint: {
    ...source.fingerprint,
    contentHash: `${source.fingerprint.contentHash}:xray-v${XRAY_DERIVATION_VERSION}:${chatModelIdentity}`,
  },
});

const serviceCache = new WeakMap<AppService, WeakMap<AISettings, Promise<XRayService>>>();

export const getXRayService = (
  appService: AppService,
  settings: AISettings,
): Promise<XRayService> => {
  let services = serviceCache.get(appService);
  if (!services) {
    services = new WeakMap();
    serviceCache.set(appService, services);
  }
  let service = services.get(settings);
  if (!service) {
    service = XRayService.open(appService, settings).catch((error) => {
      services?.delete(settings);
      throw error;
    });
    services.set(settings, service);
  }
  return service;
};
