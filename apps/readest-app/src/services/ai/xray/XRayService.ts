import type { BookDoc } from '@/libs/document';
import type { AISettings } from '@/services/ai/types';
import type { IndexBookOptions } from '@/services/reedy/retrieval/BookIndexer';
import type { AppService } from '@/types/system';

import type { GenreMetadata } from './genre';
import { ReedyXRaySource, type XRaySourceStatus } from './source/ReedyXRaySource';
import { XRayStore } from './storage/XRayStore';
import type { XRayLookupResult, XRaySnapshot } from './types';
import { XRayModelExtractor } from './XRayModelExtractor';
import { XRayPipeline, type XRayUpdateResult } from './XRayPipeline';
import { XRaySnapshotService } from './XRaySnapshotService';

export interface XRayProgressUpdate {
  readonly bookHash: string;
  readonly currentCfi: string;
  readonly bookDoc: BookDoc;
  readonly metadata?: GenreMetadata;
  readonly indexIfNeeded: boolean;
  readonly signal?: AbortSignal;
}

export type XRayProgressUpdateResult =
  | XRayUpdateResult
  | { readonly kind: 'unavailable'; readonly status: XRaySourceStatus };

export class XRayService {
  private readonly pipeline: XRayPipeline;
  private readonly snapshots: XRaySnapshotService;

  private constructor(
    private readonly source: ReedyXRaySource,
    store: XRayStore,
    extractor: XRayModelExtractor,
  ) {
    this.pipeline = new XRayPipeline(source, store, extractor);
    this.snapshots = new XRaySnapshotService(source, store);
  }

  static async open(appService: AppService, settings: AISettings): Promise<XRayService> {
    const { createXRayModels } = await import('./source/models');
    const models = createXRayModels(settings);
    const [source, store] = await Promise.all([
      ReedyXRaySource.open(appService, settings, models.embedding),
      XRayStore.open(appService),
    ]);
    return new XRayService(source, store, new XRayModelExtractor(models.chat));
  }

  getStatus(bookHash: string): Promise<XRaySourceStatus> {
    return this.source.getStatus(bookHash);
  }

  indexBook(bookDoc: BookDoc, bookHash: string, options?: IndexBookOptions): Promise<void> {
    return this.source.indexBook(bookDoc, bookHash, options);
  }

  async updateForProgress(update: XRayProgressUpdate): Promise<XRayProgressUpdateResult> {
    let status = await this.source.getStatus(update.bookHash);
    if (status.kind !== 'ready') {
      if (!update.indexIfNeeded || status.kind === 'indexing' || status.kind === 'empty_index') {
        return { kind: 'unavailable', status };
      }
      await this.source.indexBook(update.bookDoc, update.bookHash, { signal: update.signal });
      status = await this.source.getStatus(update.bookHash);
      if (status.kind !== 'ready') return { kind: 'unavailable', status };
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
