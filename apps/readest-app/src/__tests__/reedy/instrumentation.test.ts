import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import {
  NoopReedyMetrics,
  REEDY_METRICS_SCHEMA_VERSION,
  ReedyMetrics,
} from '@/services/reedy/instrumentation';

describe('ReedyMetrics', () => {
  let svc: DatabaseService;
  let metrics: ReedyMetrics;

  beforeEach(async () => {
    vi.useFakeTimers();
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    metrics = new ReedyMetrics(svc, '0.9.99-test', 'session-1');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await svc.close();
  });

  it('creates the reedy_metrics table via the new migration entry', async () => {
    const tables = await svc.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_metrics'",
    );
    expect(tables).toHaveLength(1);
  });

  it('flush writes buffered rows with app_version, session_id, schema_version', async () => {
    metrics.log('ai_tab_opened');
    metrics.log('tool_called', { bookHash: 'bk1', turnId: 't1', payload: { q: 5 } });
    await metrics.flush();

    const rows = await svc.select<{
      event: string;
      app_version: string;
      session_id: string | null;
      book_hash: string | null;
      turn_id: string | null;
      schema_version: number;
      payload: string | null;
    }>('SELECT * FROM reedy_metrics ORDER BY id ASC');

    expect(rows).toHaveLength(2);
    expect(rows[0]!.event).toBe('ai_tab_opened');
    expect(rows[0]!.app_version).toBe('0.9.99-test');
    expect(rows[0]!.session_id).toBe('session-1');
    expect(rows[0]!.schema_version).toBe(REEDY_METRICS_SCHEMA_VERSION);

    expect(rows[1]!.event).toBe('tool_called');
    expect(rows[1]!.book_hash).toBe('bk1');
    expect(rows[1]!.turn_id).toBe('t1');
    expect(JSON.parse(rows[1]!.payload!)).toEqual({ q: 5 });
  });

  it('flushes automatically after the debounce interval', async () => {
    metrics.log('ai_tab_opened');
    let rows = await svc.select('SELECT * FROM reedy_metrics');
    expect(rows).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_500);
    await metrics.flush();

    rows = await svc.select('SELECT * FROM reedy_metrics');
    expect(rows).toHaveLength(1);
  });

  it('flushes immediately when the buffer overflows', async () => {
    for (let i = 0; i < 50; i++) metrics.log('tool_called', { payload: { i } });
    // The 50th log triggers a synchronous flush() call; await it indirectly.
    await metrics.flush();
    const rows = await svc.select('SELECT * FROM reedy_metrics');
    expect(rows.length).toBe(50);
  });

  it('exportBundle returns a JSON envelope with the schema version + events', async () => {
    metrics.log('book_indexing_started', { bookHash: 'bk1' });
    // Advance the fake clock so the second event's ts strictly increases
    // and the ORDER BY ts ASC inside exportBundle is stable.
    await vi.advanceTimersByTimeAsync(5);
    metrics.log('book_indexed', { bookHash: 'bk1', payload: { chunks: 42 } });
    await metrics.flush();

    const json = await metrics.exportBundle({ days: 30 });
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('reedy-metrics-bundle');
    expect(parsed.schemaVersion).toBe(REEDY_METRICS_SCHEMA_VERSION);
    expect(parsed.windowDays).toBe(30);
    expect(parsed.eventCount).toBe(2);
    const indexed = parsed.events.find((e: { event: string }) => e.event === 'book_indexed');
    expect(indexed.payload).toEqual({ chunks: 42 });
  });

  it('exportBundle excludes rows older than the requested window', async () => {
    // Write a row "from 100 days ago" by direct SQL.
    const oldTs = Date.now() - 100 * 24 * 60 * 60 * 1000;
    await svc.execute(
      `INSERT INTO reedy_metrics (ts, event, app_version, schema_version)
         VALUES (?, ?, ?, ?)`,
      [oldTs, 'ai_tab_opened', '0.0.1', REEDY_METRICS_SCHEMA_VERSION],
    );
    metrics.log('book_indexed', { bookHash: 'bk1' });
    await metrics.flush();

    const json = await metrics.exportBundle({ days: 30 });
    const parsed = JSON.parse(json);
    expect(parsed.eventCount).toBe(1);
    expect(parsed.events[0].event).toBe('book_indexed');
  });
});

describe('NoopReedyMetrics', () => {
  it('log and flush are no-ops; exportBundle returns an empty envelope', async () => {
    const noop = new NoopReedyMetrics();
    noop.log();
    await noop.flush();
    const json = await noop.exportBundle();
    expect(JSON.parse(json).events).toEqual([]);
  });
});
