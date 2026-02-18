import {
  TextChunk,
  ScoredChunk,
  BookIndexMeta,
  AIConversation,
  AIMessage,
  XRayEntity,
  XRayRelationship,
  XRayTimelineEvent,
  XRayClaim,
  XRayTextUnit,
  XRayEntitySummary,
  XRayState,
  XRayAliasEntry,
  XRayExtractionCacheEntry,
  XRayUserOverride,
  IndexingState,
} from '../types';
import { aiLogger } from '../logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lunr = require('lunr') as typeof import('lunr');

const DB_NAME = 'readest-ai';
const DB_VERSION = 8;
const CHUNKS_STORE = 'chunks';
const META_STORE = 'bookMeta';
const BM25_STORE = 'bm25Indices';
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';
const XRAY_ENTITIES_STORE = 'xray_entities';
const XRAY_RELATIONSHIPS_STORE = 'xray_relationships';
const XRAY_EVENTS_STORE = 'xray_events';
const XRAY_CLAIMS_STORE = 'xray_claims';
const XRAY_TEXT_UNITS_STORE = 'xray_text_units';
const XRAY_STATE_STORE = 'xray_state';
const XRAY_ALIASES_STORE = 'xray_aliases';
const XRAY_EXTRACTION_CACHE_STORE = 'xray_extraction_cache';
const XRAY_OVERRIDES_STORE = 'xray_overrides';
const XRAY_ENTITY_SUMMARIES_STORE = 'xray_entity_summaries';
const INDEXING_STATE_STORE = 'rag_indexing_state';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

class AIStore {
  private db: IDBDatabase | null = null;
  private chunkCache = new Map<string, TextChunk[]>();
  private indexCache = new Map<string, lunr.Index>();
  private metaCache = new Map<string, BookIndexMeta>();
  private conversationCache = new Map<string, AIConversation[]>();
  private xrayEntityCache = new Map<string, XRayEntity[]>();
  private xrayRelationshipCache = new Map<string, XRayRelationship[]>();
  private xrayEventCache = new Map<string, XRayTimelineEvent[]>();
  private xrayClaimCache = new Map<string, XRayClaim[]>();
  private xrayTextUnitCache = new Map<string, XRayTextUnit[]>();
  private xrayStateCache = new Map<string, XRayState>();
  private xrayAliasCache = new Map<string, XRayAliasEntry[]>();
  private xrayExtractionCache = new Map<string, XRayExtractionCacheEntry>();
  private xrayOverrideCache = new Map<string, XRayUserOverride[]>();
  private xraySummaryCache = new Map<string, XRayEntitySummary>();
  private ragIndexingStateCache = new Map<string, IndexingState>();

  async recoverFromError(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore close errors
      }
      this.db = null;
    }
    this.chunkCache.clear();
    this.indexCache.clear();
    this.metaCache.clear();
    this.conversationCache.clear();
    this.xrayEntityCache.clear();
    this.xrayRelationshipCache.clear();
    this.xrayEventCache.clear();
    this.xrayClaimCache.clear();
    this.xrayTextUnitCache.clear();
    this.xrayStateCache.clear();
    this.xrayAliasCache.clear();
    this.xrayExtractionCache.clear();
    this.xrayOverrideCache.clear();
    this.xraySummaryCache.clear();
    this.ragIndexingStateCache.clear();
    await this.openDB();
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        aiLogger.store.error('openDB', request.error?.message || 'Unknown error');
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // force re-indexing on schema changes
        if (oldVersion > 0 && oldVersion < 2) {
          if (db.objectStoreNames.contains(CHUNKS_STORE)) db.deleteObjectStore(CHUNKS_STORE);
          if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
          if (db.objectStoreNames.contains(BM25_STORE)) db.deleteObjectStore(BM25_STORE);
          aiLogger.store.error('migration', 'Clearing old AI stores for re-indexing (v2)');
        }

        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          const store = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
        }
        if (!db.objectStoreNames.contains(META_STORE))
          db.createObjectStore(META_STORE, { keyPath: 'bookHash' });
        if (!db.objectStoreNames.contains(BM25_STORE))
          db.createObjectStore(BM25_STORE, { keyPath: 'bookHash' });

        // v3: conversation history stores
        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          const convStore = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
          convStore.createIndex('bookHash', 'bookHash', { unique: false });
        }
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
          msgStore.createIndex('conversationId', 'conversationId', { unique: false });
        }

        // v6: X-Ray user overrides store
        if (!db.objectStoreNames.contains(XRAY_OVERRIDES_STORE)) {
          const store = db.createObjectStore(XRAY_OVERRIDES_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('entityId', 'entityId', { unique: false });
        }

        if (!db.objectStoreNames.contains(XRAY_ENTITIES_STORE)) {
          const store = db.createObjectStore(XRAY_ENTITIES_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('canonicalName', 'canonicalName', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_RELATIONSHIPS_STORE)) {
          const store = db.createObjectStore(XRAY_RELATIONSHIPS_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('sourceId', 'sourceId', { unique: false });
          store.createIndex('targetId', 'targetId', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_EVENTS_STORE)) {
          const store = db.createObjectStore(XRAY_EVENTS_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('page', 'page', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_CLAIMS_STORE)) {
          const store = db.createObjectStore(XRAY_CLAIMS_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_TEXT_UNITS_STORE)) {
          const store = db.createObjectStore(XRAY_TEXT_UNITS_STORE, { keyPath: 'id' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('chunkId', 'chunkId', { unique: false });
          store.createIndex('page', 'page', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_STATE_STORE)) {
          db.createObjectStore(XRAY_STATE_STORE, { keyPath: 'bookHash' });
        }
        if (!db.objectStoreNames.contains(XRAY_ALIASES_STORE)) {
          const store = db.createObjectStore(XRAY_ALIASES_STORE, { keyPath: 'key' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('normalized', 'normalized', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_EXTRACTION_CACHE_STORE)) {
          const store = db.createObjectStore(XRAY_EXTRACTION_CACHE_STORE, { keyPath: 'key' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
        }
        if (!db.objectStoreNames.contains(XRAY_ENTITY_SUMMARIES_STORE)) {
          const store = db.createObjectStore(XRAY_ENTITY_SUMMARIES_STORE, { keyPath: 'key' });
          store.createIndex('bookHash', 'bookHash', { unique: false });
          store.createIndex('entityId', 'entityId', { unique: false });
        }
        if (!db.objectStoreNames.contains(INDEXING_STATE_STORE)) {
          db.createObjectStore(INDEXING_STATE_STORE, { keyPath: 'bookHash' });
        }
      };
    });
  }

  async saveMeta(meta: BookIndexMeta): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      tx.oncomplete = () => {
        this.metaCache.set(meta.bookHash, meta);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveMeta', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getMeta(bookHash: string): Promise<BookIndexMeta | null> {
    if (this.metaCache.has(bookHash)) return this.metaCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(bookHash);
      req.onsuccess = () => {
        const meta = req.result as BookIndexMeta | undefined;
        if (meta) this.metaCache.set(bookHash, meta);
        resolve(meta || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async isIndexed(bookHash: string): Promise<boolean> {
    const meta = await this.getMeta(bookHash);
    return meta !== null && meta.totalChunks > 0;
  }

  async saveIndexingState(state: IndexingState): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXING_STATE_STORE, 'readwrite');
      tx.objectStore(INDEXING_STATE_STORE).put(state);
      tx.oncomplete = () => {
        this.ragIndexingStateCache.set(state.bookHash, state);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveIndexingState', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getIndexingState(bookHash: string): Promise<IndexingState | null> {
    if (this.ragIndexingStateCache.has(bookHash)) return this.ragIndexingStateCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(INDEXING_STATE_STORE, 'readonly')
        .objectStore(INDEXING_STATE_STORE)
        .get(bookHash);
      req.onsuccess = () => {
        const state = req.result as IndexingState | undefined;
        if (state) this.ragIndexingStateCache.set(bookHash, state);
        resolve(state || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearIndexingState(bookHash: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXING_STATE_STORE, 'readwrite');
      tx.objectStore(INDEXING_STATE_STORE).delete(bookHash);
      tx.oncomplete = () => {
        this.ragIndexingStateCache.delete(bookHash);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('clearIndexingState', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async saveChunks(chunks: TextChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const bookHash = chunks[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readwrite');
      const store = tx.objectStore(CHUNKS_STORE);
      for (const chunk of chunks) store.put(chunk);
      tx.oncomplete = () => {
        this.chunkCache.set(bookHash, chunks);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveChunks', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getChunks(bookHash: string): Promise<TextChunk[]> {
    if (this.chunkCache.has(bookHash)) {
      aiLogger.store.loadChunks(bookHash, this.chunkCache.get(bookHash)!.length);
      return this.chunkCache.get(bookHash)!;
    }
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(CHUNKS_STORE, 'readonly')
        .objectStore(CHUNKS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const chunks = req.result as TextChunk[];
        this.chunkCache.set(bookHash, chunks);
        aiLogger.store.loadChunks(bookHash, chunks.length);
        resolve(chunks);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveBM25Index(bookHash: string, chunks: TextChunk[]): Promise<void> {
    const index = lunr(function (this: lunr.Builder) {
      this.ref('id');
      this.field('text');
      this.field('chapterTitle');
      this.field('chapterNumber');
      this.pipeline.remove(lunr.stemmer);
      this.searchPipeline.remove(lunr.stemmer);
      for (const chunk of chunks)
        this.add({
          id: chunk.id,
          text: chunk.text,
          chapterTitle: chunk.chapterTitle,
          chapterNumber: typeof chunk.chapterNumber === 'number' ? String(chunk.chapterNumber) : '',
        });
    });
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BM25_STORE, 'readwrite');
      tx.objectStore(BM25_STORE).put({ bookHash, serialized: JSON.stringify(index) });
      tx.oncomplete = () => {
        this.indexCache.set(bookHash, index);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveBM25Index', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  private async loadBM25Index(bookHash: string): Promise<lunr.Index | null> {
    if (this.indexCache.has(bookHash)) return this.indexCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(BM25_STORE, 'readonly').objectStore(BM25_STORE).get(bookHash);
      req.onsuccess = () => {
        const data = req.result as { serialized: string } | undefined;
        if (!data) {
          resolve(null);
          return;
        }
        try {
          const index = lunr.Index.load(JSON.parse(data.serialized));
          this.indexCache.set(bookHash, index);
          resolve(index);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async vectorSearch(
    bookHash: string,
    queryEmbedding: number[],
    topK: number,
    maxPage?: number,
  ): Promise<ScoredChunk[]> {
    const chunks = await this.getChunks(bookHash);
    const beforeFilter = chunks.filter((c) => c.embedding).length;
    const scored: ScoredChunk[] = [];
    for (const chunk of chunks) {
      if (maxPage !== undefined && chunk.pageNumber > maxPage) continue;
      if (!chunk.embedding) continue;
      scored.push({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        searchMethod: 'vector',
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK);
    if (maxPage !== undefined)
      aiLogger.search.spoilerFiltered(beforeFilter, results.length, maxPage);
    if (results.length > 0) aiLogger.search.vectorResults(results.length, results[0]!.score);
    return results;
  }

  async bm25Search(
    bookHash: string,
    query: string,
    topK: number,
    maxPage?: number,
  ): Promise<ScoredChunk[]> {
    const index = await this.loadBM25Index(bookHash);
    if (!index) return [];
    const chunks = await this.getChunks(bookHash);
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));
    try {
      const results = index.search(query);
      const scored: ScoredChunk[] = [];
      for (const result of results) {
        const chunk = chunkMap.get(result.ref);
        if (!chunk) continue;
        if (maxPage !== undefined && chunk.pageNumber > maxPage) continue;
        scored.push({ ...chunk, score: result.score, searchMethod: 'bm25' });
        if (scored.length >= topK) break;
      }
      if (scored.length > 0) aiLogger.search.bm25Results(scored.length, scored[0]!.score);
      return scored;
    } catch {
      return [];
    }
  }

  async hybridSearch(
    bookHash: string,
    queryEmbedding: number[] | null,
    query: string,
    topK: number,
    maxPage?: number,
  ): Promise<ScoredChunk[]> {
    const [vectorResults, bm25Results] = await Promise.all([
      queryEmbedding ? this.vectorSearch(bookHash, queryEmbedding, topK * 2, maxPage) : [],
      this.bm25Search(bookHash, query, topK * 2, maxPage),
    ]);
    const normalize = (results: ScoredChunk[], weight: number) => {
      if (results.length === 0) return [];
      const max = Math.max(...results.map((r) => r.score));
      return results.map((r) => ({ ...r, score: max > 0 ? (r.score / max) * weight : 0 }));
    };
    const weighted = [...normalize(vectorResults, 1.0), ...normalize(bm25Results, 0.8)];
    const merged = new Map<string, ScoredChunk>();
    for (const r of weighted) {
      const key = r.text.slice(0, 100);
      const existing = merged.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, r.score);
        existing.searchMethod = 'hybrid';
      } else merged.set(key, { ...r });
    }
    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async clearBook(bookHash: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CHUNKS_STORE, META_STORE, BM25_STORE], 'readwrite');
      const cursor = tx.objectStore(CHUNKS_STORE).index('bookHash').openCursor(bookHash);
      cursor.onsuccess = (e) => {
        const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
      tx.objectStore(META_STORE).delete(bookHash);
      tx.objectStore(BM25_STORE).delete(bookHash);
      tx.oncomplete = () => {
        this.chunkCache.delete(bookHash);
        this.indexCache.delete(bookHash);
        this.metaCache.delete(bookHash);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveXRayEntities(entities: XRayEntity[]): Promise<void> {
    if (entities.length === 0) return;
    const bookHash = entities[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_ENTITIES_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_ENTITIES_STORE);
      for (const entity of entities) store.put(entity);
      tx.oncomplete = () => {
        const cached = this.xrayEntityCache.get(bookHash);
        if (cached) {
          const map = new Map(cached.map((item) => [item.id, item]));
          entities.forEach((entity) => map.set(entity.id, entity));
          this.xrayEntityCache.set(bookHash, Array.from(map.values()));
        }
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayEntities', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayEntities(bookHash: string): Promise<XRayEntity[]> {
    if (this.xrayEntityCache.has(bookHash)) return this.xrayEntityCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_ENTITIES_STORE, 'readonly')
        .objectStore(XRAY_ENTITIES_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const entities = req.result as XRayEntity[];
        this.xrayEntityCache.set(bookHash, entities);
        resolve(entities);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayRelationships(relationships: XRayRelationship[]): Promise<void> {
    if (relationships.length === 0) return;
    const bookHash = relationships[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_RELATIONSHIPS_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_RELATIONSHIPS_STORE);
      for (const relationship of relationships) store.put(relationship);
      tx.oncomplete = () => {
        const cached = this.xrayRelationshipCache.get(bookHash);
        if (cached) {
          const map = new Map(cached.map((item) => [item.id, item]));
          relationships.forEach((rel) => map.set(rel.id, rel));
          this.xrayRelationshipCache.set(bookHash, Array.from(map.values()));
        }
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayRelationships', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayRelationships(bookHash: string): Promise<XRayRelationship[]> {
    if (this.xrayRelationshipCache.has(bookHash)) return this.xrayRelationshipCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_RELATIONSHIPS_STORE, 'readonly')
        .objectStore(XRAY_RELATIONSHIPS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const relationships = req.result as XRayRelationship[];
        this.xrayRelationshipCache.set(bookHash, relationships);
        resolve(relationships);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayEvents(events: XRayTimelineEvent[]): Promise<void> {
    if (events.length === 0) return;
    const bookHash = events[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_EVENTS_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_EVENTS_STORE);
      for (const event of events) store.put(event);
      tx.oncomplete = () => {
        const cached = this.xrayEventCache.get(bookHash);
        if (cached) {
          const map = new Map(cached.map((item) => [item.id, item]));
          events.forEach((item) => map.set(item.id, item));
          this.xrayEventCache.set(bookHash, Array.from(map.values()));
        }
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayEvents', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayEvents(bookHash: string): Promise<XRayTimelineEvent[]> {
    if (this.xrayEventCache.has(bookHash)) return this.xrayEventCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_EVENTS_STORE, 'readonly')
        .objectStore(XRAY_EVENTS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const events = req.result as XRayTimelineEvent[];
        this.xrayEventCache.set(bookHash, events);
        resolve(events);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayClaims(claims: XRayClaim[]): Promise<void> {
    if (claims.length === 0) return;
    const bookHash = claims[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_CLAIMS_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_CLAIMS_STORE);
      for (const claim of claims) store.put(claim);
      tx.oncomplete = () => {
        const cached = this.xrayClaimCache.get(bookHash);
        if (cached) {
          const map = new Map(cached.map((item) => [item.id, item]));
          claims.forEach((item) => map.set(item.id, item));
          this.xrayClaimCache.set(bookHash, Array.from(map.values()));
        }
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayClaims', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayClaims(bookHash: string): Promise<XRayClaim[]> {
    if (this.xrayClaimCache.has(bookHash)) return this.xrayClaimCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_CLAIMS_STORE, 'readonly')
        .objectStore(XRAY_CLAIMS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const claims = req.result as XRayClaim[];
        this.xrayClaimCache.set(bookHash, claims);
        resolve(claims);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayTextUnits(textUnits: XRayTextUnit[]): Promise<void> {
    if (textUnits.length === 0) return;
    const bookHash = textUnits[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_TEXT_UNITS_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_TEXT_UNITS_STORE);
      for (const unit of textUnits) store.put(unit);
      tx.oncomplete = () => {
        const cached = this.xrayTextUnitCache.get(bookHash);
        if (cached) {
          const map = new Map(cached.map((item) => [item.id, item]));
          textUnits.forEach((item) => map.set(item.id, item));
          this.xrayTextUnitCache.set(bookHash, Array.from(map.values()));
        }
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayTextUnits', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayTextUnits(bookHash: string): Promise<XRayTextUnit[]> {
    if (this.xrayTextUnitCache.has(bookHash)) return this.xrayTextUnitCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_TEXT_UNITS_STORE, 'readonly')
        .objectStore(XRAY_TEXT_UNITS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const units = req.result as XRayTextUnit[];
        this.xrayTextUnitCache.set(bookHash, units);
        resolve(units);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayState(state: XRayState): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_STATE_STORE, 'readwrite');
      tx.objectStore(XRAY_STATE_STORE).put(state);
      tx.oncomplete = () => {
        this.xrayStateCache.set(state.bookHash, state);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayState', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayState(bookHash: string): Promise<XRayState | null> {
    if (this.xrayStateCache.has(bookHash)) return this.xrayStateCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_STATE_STORE, 'readonly')
        .objectStore(XRAY_STATE_STORE)
        .get(bookHash);
      req.onsuccess = () => {
        const state = req.result as XRayState | undefined;
        if (state) this.xrayStateCache.set(bookHash, state);
        resolve(state || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayAliases(entries: XRayAliasEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const bookHash = entries[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_ALIASES_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_ALIASES_STORE);
      for (const entry of entries) store.put(entry);
      tx.oncomplete = () => {
        const cached = this.xrayAliasCache.get(bookHash);
        if (cached) {
          const map = new Map(cached.map((item) => [item.key, item]));
          entries.forEach((entry) => map.set(entry.key, entry));
          this.xrayAliasCache.set(bookHash, Array.from(map.values()));
        }
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayAliases', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayAliases(bookHash: string): Promise<XRayAliasEntry[]> {
    if (this.xrayAliasCache.has(bookHash)) return this.xrayAliasCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_ALIASES_STORE, 'readonly')
        .objectStore(XRAY_ALIASES_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const entries = req.result as XRayAliasEntry[];
        this.xrayAliasCache.set(bookHash, entries);
        resolve(entries);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayExtractionCache(entry: XRayExtractionCacheEntry): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_EXTRACTION_CACHE_STORE, 'readwrite');
      tx.objectStore(XRAY_EXTRACTION_CACHE_STORE).put(entry);
      tx.oncomplete = () => {
        this.xrayExtractionCache.set(entry.key, entry);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getXRayExtractionCache(key: string): Promise<XRayExtractionCacheEntry | null> {
    if (this.xrayExtractionCache.has(key)) return this.xrayExtractionCache.get(key)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_EXTRACTION_CACHE_STORE, 'readonly')
        .objectStore(XRAY_EXTRACTION_CACHE_STORE)
        .get(key);
      req.onsuccess = () => {
        const entry = req.result as XRayExtractionCacheEntry | undefined;
        if (entry) this.xrayExtractionCache.set(key, entry);
        resolve(entry || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveXRayEntitySummary(summary: XRayEntitySummary): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_ENTITY_SUMMARIES_STORE, 'readwrite');
      tx.objectStore(XRAY_ENTITY_SUMMARIES_STORE).put(summary);
      tx.oncomplete = () => {
        this.xraySummaryCache.set(summary.key, summary);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getXRayEntitySummary(key: string): Promise<XRayEntitySummary | null> {
    if (this.xraySummaryCache.has(key)) return this.xraySummaryCache.get(key)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_ENTITY_SUMMARIES_STORE, 'readonly')
        .objectStore(XRAY_ENTITY_SUMMARIES_STORE)
        .get(key);
      req.onsuccess = () => {
        const entry = req.result as XRayEntitySummary | undefined;
        if (entry) this.xraySummaryCache.set(key, entry);
        resolve(entry || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearXRayBook(bookHash: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [
          XRAY_ENTITIES_STORE,
          XRAY_RELATIONSHIPS_STORE,
          XRAY_EVENTS_STORE,
          XRAY_CLAIMS_STORE,
          XRAY_TEXT_UNITS_STORE,
          XRAY_ALIASES_STORE,
          XRAY_STATE_STORE,
          XRAY_EXTRACTION_CACHE_STORE,
          XRAY_OVERRIDES_STORE,
          XRAY_ENTITY_SUMMARIES_STORE,
        ],
        'readwrite',
      );

      const clearByIndex = (storeName: string) => {
        const store = tx.objectStore(storeName);
        const cursor = store.index('bookHash').openCursor(bookHash);
        cursor.onsuccess = (e) => {
          const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (c) {
            c.delete();
            c.continue();
          }
        };
      };

      clearByIndex(XRAY_ENTITIES_STORE);
      clearByIndex(XRAY_RELATIONSHIPS_STORE);
      clearByIndex(XRAY_EVENTS_STORE);
      clearByIndex(XRAY_CLAIMS_STORE);
      clearByIndex(XRAY_TEXT_UNITS_STORE);
      clearByIndex(XRAY_ALIASES_STORE);
      clearByIndex(XRAY_EXTRACTION_CACHE_STORE);
      clearByIndex(XRAY_OVERRIDES_STORE);
      clearByIndex(XRAY_ENTITY_SUMMARIES_STORE);
      tx.objectStore(XRAY_STATE_STORE).delete(bookHash);

      tx.oncomplete = () => {
        this.xrayEntityCache.delete(bookHash);
        this.xrayRelationshipCache.delete(bookHash);
        this.xrayEventCache.delete(bookHash);
        this.xrayClaimCache.delete(bookHash);
        this.xrayTextUnitCache.delete(bookHash);
        this.xrayAliasCache.delete(bookHash);
        this.xrayStateCache.delete(bookHash);
        this.xrayOverrideCache.delete(bookHash);
        for (const [key, entry] of this.xraySummaryCache.entries()) {
          if (entry.bookHash === bookHash) {
            this.xraySummaryCache.delete(key);
          }
        }
        // Clear extraction cache entries for this book
        for (const [key, entry] of this.xrayExtractionCache.entries()) {
          if (entry.bookHash === bookHash) {
            this.xrayExtractionCache.delete(key);
          }
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // X-Ray user overrides methods

  async saveXRayOverrides(overrides: XRayUserOverride[]): Promise<void> {
    if (overrides.length === 0) return;
    const bookHash = overrides[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_OVERRIDES_STORE, 'readwrite');
      const store = tx.objectStore(XRAY_OVERRIDES_STORE);
      for (const override of overrides) store.put(override);
      tx.oncomplete = () => {
        this.xrayOverrideCache.delete(bookHash);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveXRayOverrides', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getXRayOverrides(bookHash: string): Promise<XRayUserOverride[]> {
    if (this.xrayOverrideCache.has(bookHash)) {
      return this.xrayOverrideCache.get(bookHash)!;
    }
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(XRAY_OVERRIDES_STORE, 'readonly')
        .objectStore(XRAY_OVERRIDES_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const overrides = req.result as XRayUserOverride[];
        this.xrayOverrideCache.set(bookHash, overrides);
        resolve(overrides);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteXRayOverride(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(XRAY_OVERRIDES_STORE, 'readwrite');
      tx.objectStore(XRAY_OVERRIDES_STORE).delete(id);
      tx.oncomplete = () => {
        // Clear all override caches since we don't know which book this belongs to
        this.xrayOverrideCache.clear();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // conversation persistence methods

  async saveConversation(conversation: AIConversation): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      tx.objectStore(CONVERSATIONS_STORE).put(conversation);
      tx.oncomplete = () => {
        this.conversationCache.delete(conversation.bookHash);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveConversation', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getConversations(bookHash: string): Promise<AIConversation[]> {
    if (this.conversationCache.has(bookHash)) {
      return this.conversationCache.get(bookHash)!;
    }
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(CONVERSATIONS_STORE, 'readonly')
        .objectStore(CONVERSATIONS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const conversations = (req.result as AIConversation[]).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        this.conversationCache.set(bookHash, conversations);
        resolve(conversations);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');

      // delete conversation
      tx.objectStore(CONVERSATIONS_STORE).delete(id);

      // delete all messages for this conversation
      const cursor = tx.objectStore(MESSAGES_STORE).index('conversationId').openCursor(id);
      cursor.onsuccess = (e) => {
        const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (c) {
          c.delete();
          c.continue();
        }
      };

      tx.oncomplete = () => {
        this.conversationCache.clear();
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('deleteConversation', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const conversation = req.result as AIConversation | undefined;
        if (conversation) {
          conversation.title = title;
          conversation.updatedAt = Date.now();
          store.put(conversation);
        }
      };
      tx.oncomplete = () => {
        this.conversationCache.clear();
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('updateConversationTitle', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async saveMessage(message: AIMessage): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, 'readwrite');
      tx.objectStore(MESSAGES_STORE).put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        aiLogger.store.error('saveMessage', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getMessages(conversationId: string): Promise<AIMessage[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(MESSAGES_STORE, 'readonly')
        .objectStore(MESSAGES_STORE)
        .index('conversationId')
        .getAll(conversationId);
      req.onsuccess = () => {
        const messages = (req.result as AIMessage[]).sort((a, b) => a.createdAt - b.createdAt);
        resolve(messages);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export const aiStore = new AIStore();
