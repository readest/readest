import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

/**
 * MVP measurement (plan §M1.9). Writes to the local `reedy_metrics` table.
 * Always-on local; no network egress. The user can manually export a 90-day
 * JSON bundle from settings.
 *
 * Why this matters: the previous draft of M1.9 wrote to console.info only,
 * which can't leave the user's machine. The 4-week measurement plan that
 * gates Appendix A (Phases 2-6) depends on real data. Without it, the gating
 * decision is theater. See plan §M1.9 + 'MVP Verification' for the targets.
 */

export const REEDY_METRICS_SCHEMA_VERSION = 1;

export type ReedyEvent =
  // activation
  | 'reedy_enabled_first_time'
  | 'ai_tab_opened'
  | 'book_indexing_started'
  | 'book_indexed'
  | 'book_indexing_failed'
  // use (Reedy path)
  | 'tool_called'
  | 'tool_call_cached'
  | 'tool_returned_empty'
  | 'tool_returned_stale'
  | 'tool_returned_empty_index'
  | 'embedding_timeout'
  | 'budget_exceeded'
  | 'model_skipped_tool_call'
  | 'citations_rendered'
  | 'citation_clicked'
  | 'citation_engaged_5s'
  // quality
  | 'assistant_message_thumbed_up'
  | 'assistant_message_thumbed_down'
  // control arm (legacy IDB)
  | 'legacy_chat_sent'
  | 'legacy_hybrid_search_called'
  | 'legacy_message_responded'
  | 'legacy_citation_clicked';

export interface ReedyMetricEnvelope {
  bookHash?: string;
  sessionId?: string;
  turnId?: string;
  messageId?: string;
  payload?: Record<string, unknown>;
}

export interface ReedyMetricsWriter {
  log(event: ReedyEvent, env?: ReedyMetricEnvelope): void;
  /** Flush any buffered rows. Used by `exportBundle()` so it doesn't miss them. */
  flush(): Promise<void>;
  exportBundle(opts?: { days?: number }): Promise<string>;
}

/**
 * Debounced batching writer. Events are accumulated in memory and flushed
 * to SQLite every `FLUSH_INTERVAL_MS` or when the buffer reaches
 * `MAX_BUFFER_SIZE` — whichever comes first. Keeps the hot path off
 * synchronous disk I/O.
 */
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BUFFER_SIZE = 50;
const DEFAULT_EXPORT_DAYS = 90;

interface BufferedRow {
  ts: number;
  event: ReedyEvent;
  bookHash: string | null;
  sessionId: string | null;
  turnId: string | null;
  messageId: string | null;
  appVersion: string;
  schemaVersion: number;
  payload: string | null;
}

export class ReedyMetrics implements ReedyMetricsWriter {
  private buffer: BufferedRow[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly appVersion: string,
    private readonly sessionId: string,
  ) {}

  log(event: ReedyEvent, env?: ReedyMetricEnvelope): void {
    this.buffer.push({
      ts: Date.now(),
      event,
      bookHash: env?.bookHash ?? null,
      sessionId: env?.sessionId ?? this.sessionId,
      turnId: env?.turnId ?? null,
      messageId: env?.messageId ?? null,
      appVersion: this.appVersion,
      schemaVersion: REEDY_METRICS_SCHEMA_VERSION,
      payload: env?.payload ? JSON.stringify(env.payload) : null,
    });

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      // After the in-flight flush completes, if new rows accumulated, flush again.
      if (this.buffer.length === 0) return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];
    this.flushing = this.writeBatch(batch).finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  private async writeBatch(rows: BufferedRow[]): Promise<void> {
    // Use single-row execute() calls rather than batch() — DatabaseService.batch
    // takes raw SQL strings with no parameter binding, and event payloads can
    // contain arbitrary user content (book titles, query text). Single
    // execute() goes through prepared statements with proper escaping.
    for (const row of rows) {
      try {
        await this.db.execute(
          `INSERT INTO reedy_metrics
             (ts, event, book_hash, session_id, turn_id, message_id, app_version, schema_version, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.ts,
            row.event,
            row.bookHash,
            row.sessionId,
            row.turnId,
            row.messageId,
            row.appVersion,
            row.schemaVersion,
            row.payload,
          ],
        );
      } catch (err) {
        // Best-effort: never let metrics failures bubble back to the user.
        console.warn('[Reedy] metrics write failed', err);
      }
    }
  }

  async exportBundle(opts?: { days?: number }): Promise<string> {
    await this.flush();
    const days = opts?.days ?? DEFAULT_EXPORT_DAYS;
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = await this.db.select<{
      id: number;
      ts: number;
      event: string;
      book_hash: string | null;
      session_id: string | null;
      turn_id: string | null;
      message_id: string | null;
      app_version: string;
      schema_version: number;
      payload: string | null;
    }>('SELECT * FROM reedy_metrics WHERE ts >= ? ORDER BY ts ASC', [since]);

    return JSON.stringify(
      {
        format: 'reedy-metrics-bundle',
        schemaVersion: REEDY_METRICS_SCHEMA_VERSION,
        exportedAt: Date.now(),
        windowDays: days,
        eventCount: rows.length,
        events: rows.map((r) => ({
          ts: r.ts,
          event: r.event,
          bookHash: r.book_hash,
          sessionId: r.session_id,
          turnId: r.turn_id,
          messageId: r.message_id,
          appVersion: r.app_version,
          schemaVersion: r.schema_version,
          payload: r.payload ? JSON.parse(r.payload) : null,
        })),
      },
      null,
      2,
    );
  }
}

/**
 * One-shot helper for the AI panel's "Send Reedy feedback" button. Opens
 * reedy.db, exports the bundle, and closes — no need to keep a long-lived
 * ReedyBackend just for the export.
 */
export async function exportReedyMetricsBundle(
  appService: AppService,
  opts?: { days?: number },
): Promise<string> {
  const db = await appService.openDatabase('reedy', 'reedy.db', 'Data', {
    experimental: ['index_method'],
  });
  try {
    const writer = new ReedyMetrics(db, '0.0.0', 'export');
    return await writer.exportBundle(opts);
  } finally {
    await db.close();
  }
}

/**
 * No-op writer for tests and contexts that don't need metrics (web users,
 * the legacy path before Reedy is enabled, etc.). Implements the same
 * interface so callers don't have to null-check.
 */
export class NoopReedyMetrics implements ReedyMetricsWriter {
  log(): void {
    /* noop */
  }
  async flush(): Promise<void> {
    /* noop */
  }
  async exportBundle(): Promise<string> {
    return JSON.stringify({ format: 'reedy-metrics-bundle', events: [] });
  }
}
