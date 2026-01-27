import { TextChunk, ScoredChunk, BookIndexMeta, AIConversation, AIMessage } from '../types';
import { aiLogger } from '../logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lunr = require('lunr') as typeof import('lunr');

const DB_NAME = 'readest-ai';
const DB_VERSION = 3;
const CHUNKS_STORE = 'chunks';
const META_STORE = 'bookMeta';
const BM25_STORE = 'bm25Indices';
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';

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
      this.pipeline.remove(lunr.stemmer);
      this.searchPipeline.remove(lunr.stemmer);
      for (const chunk of chunks)
        this.add({ id: chunk.id, text: chunk.text, chapterTitle: chunk.chapterTitle });
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
