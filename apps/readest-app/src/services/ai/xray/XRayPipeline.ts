import { detectGenre, getGenreHints, type GenreHints, type GenreMetadata } from './genre';
import type { ReedyXRaySource } from './source/ReedyXRaySource';
import type { XRayStore } from './storage/XRayStore';
import type {
  XRayBookFingerprint,
  XRayBookState,
  XRayExtractionBatch,
  XRayModelExtraction,
  XRaySourceUnit,
} from './types';
import { validateXRayExtraction } from './validators';

const DEFAULT_MAX_UNITS_PER_BATCH = 8;
const XRAY_STATE_VERSION = 1;
const updateQueues = new Map<string, Promise<XRayUpdateResult>>();

export interface XRayExtractionRequest {
  readonly units: readonly XRaySourceUnit[];
  readonly genre: GenreHints;
  readonly signal?: AbortSignal;
}

export interface XRayExtractionModel {
  extract(request: XRayExtractionRequest): Promise<XRayModelExtraction>;
}

export interface XRayPipelineOptions {
  readonly maxUnitsPerBatch?: number;
}

export interface XRayUpdateOptions {
  readonly metadata?: GenreMetadata;
  readonly signal?: AbortSignal;
  readonly onProgress?: (completedUnits: number, totalUnits: number) => void;
}

export interface XRayUpdateResult {
  readonly kind: 'current' | 'updated';
  readonly batchCount: number;
  readonly unitCount: number;
  readonly maxPositionIndex: number;
}

export class XRayPipeline {
  private readonly maxUnitsPerBatch: number;

  constructor(
    private readonly source: Pick<ReedyXRaySource, 'readThrough'>,
    private readonly store: XRayStore,
    private readonly model: XRayExtractionModel,
    options: XRayPipelineOptions = {},
  ) {
    this.maxUnitsPerBatch = Math.max(
      1,
      Math.floor(options.maxUnitsPerBatch ?? DEFAULT_MAX_UNITS_PER_BATCH),
    );
  }

  async update(
    bookHash: string,
    currentCfi: string,
    options: XRayUpdateOptions = {},
  ): Promise<XRayUpdateResult> {
    const previous = updateQueues.get(bookHash);
    const waitForPrevious = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const current = waitForPrevious.then(() => this.runUpdate(bookHash, currentCfi, options));
    updateQueues.set(bookHash, current);
    void current
      .finally(() => {
        if (updateQueues.get(bookHash) === current) updateQueues.delete(bookHash);
      })
      .catch(() => undefined);
    return current;
  }

  private async runUpdate(
    bookHash: string,
    currentCfi: string,
    options: XRayUpdateOptions,
  ): Promise<XRayUpdateResult> {
    const source = await this.source.readThrough(bookHash, currentCfi);
    let state = await this.store.getState(bookHash);

    if (
      state &&
      (state.version !== XRAY_STATE_VERSION ||
        !sameFingerprint(state.fingerprint, source.fingerprint))
    ) {
      await this.store.clearBook(bookHash);
      state = null;
    }

    if (!state) {
      state = initialState(source.fingerprint);
      await this.store.saveState(state);
    }

    const committedPosition = state.maxPositionIndex;
    const pendingUnits = source.units.filter((item) => item.positionIndex > committedPosition);
    if (pendingUnits.length === 0) {
      return {
        kind: 'current',
        batchCount: 0,
        unitCount: 0,
        maxPositionIndex: source.maxPositionIndex,
      };
    }

    const genre = options.metadata ? detectGenre(options.metadata) : getGenreHints('unknown');
    let cursor = committedPosition;
    let completedUnits = 0;
    let batchCount = 0;

    for (let offset = 0; offset < pendingUnits.length; offset += this.maxUnitsPerBatch) {
      if (options.signal?.aborted) throw new Error('X-Ray extraction aborted');
      const units = pendingUnits.slice(offset, offset + this.maxUnitsPerBatch);
      const minPositionIndex = units[0]!.positionIndex;
      const maxPositionIndex = units.at(-1)!.positionIndex;
      const batchId = batchKey(source.fingerprint, minPositionIndex, maxPositionIndex);
      const extracted = await this.model.extract({ units, genre, signal: options.signal });
      const output = validateXRayExtraction(extracted, units, maxPositionIndex);
      const batch: XRayExtractionBatch = {
        batchId,
        fingerprint: source.fingerprint,
        sourceUnitIds: units.map((item) => item.unitId),
        minPositionIndex,
        maxPositionIndex,
        output,
        createdAt: Date.now(),
      };
      const committedState: XRayBookState = {
        fingerprint: source.fingerprint,
        maxPositionIndex,
        lastBatchId: batchId,
        updatedAt: Date.now(),
        version: XRAY_STATE_VERSION,
      };
      await this.store.commitBatch(batch, committedState);
      cursor = maxPositionIndex;
      completedUnits += units.length;
      batchCount += 1;
      options.onProgress?.(completedUnits, pendingUnits.length);
    }

    return {
      kind: 'updated',
      batchCount,
      unitCount: completedUnits,
      maxPositionIndex: cursor,
    };
  }
}

const sameFingerprint = (left: XRayBookFingerprint, right: XRayBookFingerprint): boolean =>
  left.bookHash === right.bookHash && left.contentHash === right.contentHash;

const initialState = (fingerprint: XRayBookFingerprint): XRayBookState => ({
  fingerprint,
  maxPositionIndex: -1,
  updatedAt: Date.now(),
  version: XRAY_STATE_VERSION,
});

const batchKey = (
  fingerprint: XRayBookFingerprint,
  minPositionIndex: number,
  maxPositionIndex: number,
): string => `${fingerprint.contentHash}:${minPositionIndex}-${maxPositionIndex}`;
