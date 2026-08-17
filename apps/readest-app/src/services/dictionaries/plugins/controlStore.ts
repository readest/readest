import type { DatabaseRow, DatabaseService } from '@/types/database';

export type DictionaryPluginGenerationState =
  | 'staging'
  | 'active'
  | 'healthy'
  | 'previous'
  | 'failed'
  | 'tombstoned';

export interface DictionaryPluginLease {
  dictionaryId: string;
  owner: string;
  operation: 'build' | 'remove';
  expiresAt: number;
}

export interface DictionaryPluginGeneration {
  dictionaryId: string;
  pluginId: string;
  buildId: string;
  databasePath: string;
  indexVersion: number;
  state: DictionaryPluginGenerationState;
  createdAt: number;
}

interface ControlStoreOptions {
  now?: () => number;
  createId?: () => string;
  deleteDatabase: (path: string) => Promise<void>;
}

const randomId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const stringValue = (row: DatabaseRow, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Invalid plugin control value: ${key}`);
  return value;
};

const numberValue = (row: DatabaseRow, key: string): number => {
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Invalid plugin control value: ${key}`);
  return value;
};

export class DictionaryPluginControlStore {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly deleteDatabase: (path: string) => Promise<void>;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: DatabaseService,
    options: ControlStoreOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomId;
    this.deleteDatabase = options.deleteDatabase;
  }

  async initialize(): Promise<void> {
    await this.db.execute(
      'CREATE TABLE IF NOT EXISTS dictionary_plugin_leases (dictionary_id TEXT PRIMARY KEY, owner TEXT NOT NULL, operation TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    );
    await this.db.execute(
      'CREATE TABLE IF NOT EXISTS dictionary_plugin_generations (dictionary_id TEXT NOT NULL, plugin_id TEXT NOT NULL, build_id TEXT NOT NULL, database_path TEXT NOT NULL, index_version INTEGER NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (dictionary_id, build_id))',
    );
    await this.db.execute(
      'CREATE TABLE IF NOT EXISTS dictionary_plugin_active (dictionary_id TEXT PRIMARY KEY, active_build_id TEXT NOT NULL, previous_build_id TEXT)',
    );
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action, action);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async transaction<T>(action: () => Promise<T>): Promise<T> {
    await this.db.execute('BEGIN IMMEDIATE');
    try {
      const result = await action();
      await this.db.execute('COMMIT');
      return result;
    } catch (error) {
      await this.db.execute('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  async acquireLease(
    dictionaryId: string,
    operation: DictionaryPluginLease['operation'],
    ttlMs = 5 * 60 * 1_000,
  ): Promise<DictionaryPluginLease> {
    return this.serialized(() =>
      this.transaction(async () => {
        const now = this.now();
        const rows = await this.db.select(
          'SELECT owner, expires_at FROM dictionary_plugin_leases WHERE dictionary_id = ?',
          [dictionaryId],
        );
        const current = rows[0];
        if (current && numberValue(current, 'expires_at') > now) {
          throw new Error(`Dictionary plugin operation is busy: ${dictionaryId}`);
        }
        const lease: DictionaryPluginLease = {
          dictionaryId,
          owner: this.createId(),
          operation,
          expiresAt: now + ttlMs,
        };
        await this.db.execute(
          'INSERT OR REPLACE INTO dictionary_plugin_leases (dictionary_id, owner, operation, expires_at) VALUES (?, ?, ?, ?)',
          [lease.dictionaryId, lease.owner, lease.operation, lease.expiresAt],
        );
        return lease;
      }),
    );
  }

  async releaseLease(lease: DictionaryPluginLease): Promise<void> {
    await this.serialized(async () => {
      await this.db.execute(
        'DELETE FROM dictionary_plugin_leases WHERE dictionary_id = ? AND owner = ?',
        [lease.dictionaryId, lease.owner],
      );
    });
  }

  async renewLease(
    lease: DictionaryPluginLease,
    ttlMs = 5 * 60 * 1_000,
  ): Promise<DictionaryPluginLease> {
    return this.serialized(() =>
      this.transaction(async () => {
        const now = this.now();
        const rows = await this.db.select(
          'SELECT owner, expires_at FROM dictionary_plugin_leases WHERE dictionary_id = ?',
          [lease.dictionaryId],
        );
        const current = rows[0];
        if (
          !current ||
          stringValue(current, 'owner') !== lease.owner ||
          numberValue(current, 'expires_at') <= now
        ) {
          throw new Error(`Dictionary plugin lease is no longer valid: ${lease.dictionaryId}`);
        }
        const renewed = { ...lease, expiresAt: now + ttlMs };
        await this.db.execute(
          'UPDATE dictionary_plugin_leases SET expires_at = ? WHERE dictionary_id = ? AND owner = ?',
          [renewed.expiresAt, lease.dictionaryId, lease.owner],
        );
        return renewed;
      }),
    );
  }

  startLeaseHeartbeat(lease: DictionaryPluginLease, intervalMs = 60_000): () => Promise<void> {
    let stopped = false;
    let renewal: Promise<void> | undefined;
    let renewalError: unknown;
    const renew = (): void => {
      if (stopped || renewal || renewalError) return;
      renewal = this.renewLease(lease)
        .then(() => undefined)
        .catch((error: unknown) => {
          renewalError = error;
        })
        .finally(() => {
          renewal = undefined;
        });
    };
    const timer = globalThis.setInterval(renew, intervalMs);
    return async (): Promise<void> => {
      if (!stopped) {
        stopped = true;
        globalThis.clearInterval(timer);
      }
      await renewal;
      if (renewalError) throw renewalError;
    };
  }

  private async requireLease(lease: DictionaryPluginLease): Promise<void> {
    const rows = await this.db.select(
      'SELECT owner, expires_at FROM dictionary_plugin_leases WHERE dictionary_id = ?',
      [lease.dictionaryId],
    );
    const current = rows[0];
    if (
      !current ||
      stringValue(current, 'owner') !== lease.owner ||
      numberValue(current, 'expires_at') <= this.now()
    ) {
      throw new Error(`Dictionary plugin lease is no longer valid: ${lease.dictionaryId}`);
    }
  }

  async stageGeneration(
    lease: DictionaryPluginLease,
    pluginId: string,
    buildId: string,
    databasePath: string,
    indexVersion: number,
  ): Promise<void> {
    await this.serialized(() =>
      this.transaction(async () => {
        await this.requireLease(lease);
        await this.db.execute(
          'INSERT INTO dictionary_plugin_generations (dictionary_id, plugin_id, build_id, database_path, index_version, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            lease.dictionaryId,
            pluginId,
            buildId,
            databasePath,
            indexVersion,
            'staging',
            this.now(),
          ],
        );
      }),
    );
  }

  async activateGeneration(lease: DictionaryPluginLease, buildId: string): Promise<void> {
    await this.serialized(() =>
      this.transaction(async () => {
        await this.requireLease(lease);
        const generation = await this.db.select(
          'SELECT state FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
          [lease.dictionaryId, buildId],
        );
        if (generation[0]?.['state'] !== 'staging') {
          throw new Error(`Dictionary plugin generation is not staged: ${buildId}`);
        }
        const current = await this.db.select(
          'SELECT active_build_id FROM dictionary_plugin_active WHERE dictionary_id = ?',
          [lease.dictionaryId],
        );
        const previous = current[0]?.['active_build_id'];
        if (typeof previous === 'string') {
          await this.db.execute(
            "UPDATE dictionary_plugin_generations SET state = 'previous' WHERE dictionary_id = ? AND build_id = ?",
            [lease.dictionaryId, previous],
          );
        }
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'active' WHERE dictionary_id = ? AND build_id = ?",
          [lease.dictionaryId, buildId],
        );
        await this.db.execute(
          'INSERT OR REPLACE INTO dictionary_plugin_active (dictionary_id, active_build_id, previous_build_id) VALUES (?, ?, ?)',
          [lease.dictionaryId, buildId, typeof previous === 'string' ? previous : null],
        );
      }),
    );
  }

  private generationFromRow(row: DatabaseRow): DictionaryPluginGeneration {
    return {
      dictionaryId: stringValue(row, 'dictionary_id'),
      pluginId: stringValue(row, 'plugin_id'),
      buildId: stringValue(row, 'build_id'),
      databasePath: stringValue(row, 'database_path'),
      indexVersion: numberValue(row, 'index_version'),
      state: stringValue(row, 'state') as DictionaryPluginGenerationState,
      createdAt: numberValue(row, 'created_at'),
    };
  }

  async getGeneration(
    dictionaryId: string,
    buildId: string,
  ): Promise<DictionaryPluginGeneration | undefined> {
    const rows = await this.db.select(
      'SELECT dictionary_id, plugin_id, build_id, database_path, index_version, state, created_at FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
      [dictionaryId, buildId],
    );
    return rows[0] ? this.generationFromRow(rows[0]) : undefined;
  }

  async getActiveGeneration(dictionaryId: string): Promise<DictionaryPluginGeneration | undefined> {
    const rows = await this.db.select(
      'SELECT g.dictionary_id, g.plugin_id, g.build_id, g.database_path, g.index_version, g.state, g.created_at FROM dictionary_plugin_active a JOIN dictionary_plugin_generations g ON g.dictionary_id = a.dictionary_id AND g.build_id = a.active_build_id WHERE a.dictionary_id = ?',
      [dictionaryId],
    );
    return rows[0] ? this.generationFromRow(rows[0]) : undefined;
  }

  async markGenerationHealthy(dictionaryId: string, buildId: string): Promise<void> {
    const previous = await this.serialized(() =>
      this.transaction(async () => {
        const rows = await this.db.select(
          'SELECT active_build_id, previous_build_id FROM dictionary_plugin_active WHERE dictionary_id = ?',
          [dictionaryId],
        );
        const pointer = rows[0];
        if (!pointer || pointer['active_build_id'] !== buildId) {
          throw new Error(`Dictionary plugin generation is not active: ${buildId}`);
        }
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'healthy' WHERE dictionary_id = ? AND build_id = ?",
          [dictionaryId, buildId],
        );
        const previousBuildId = pointer['previous_build_id'];
        if (typeof previousBuildId !== 'string') return undefined;
        const generations = await this.db.select(
          'SELECT database_path FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
          [dictionaryId, previousBuildId],
        );
        const databasePath = generations[0]?.['database_path'];
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'tombstoned' WHERE dictionary_id = ? AND build_id = ?",
          [dictionaryId, previousBuildId],
        );
        await this.db.execute(
          'UPDATE dictionary_plugin_active SET previous_build_id = NULL WHERE dictionary_id = ?',
          [dictionaryId],
        );
        return typeof databasePath === 'string'
          ? { buildId: previousBuildId, databasePath }
          : undefined;
      }),
    );
    if (!previous) return;
    try {
      await this.deleteDatabase(previous.databasePath);
      await this.db.execute(
        'DELETE FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
        [dictionaryId, previous.buildId],
      );
    } catch {
      // The tombstone is retried by cleanup after open handles are released.
    }
  }

  async rollbackUnhealthyGeneration(dictionaryId: string, buildId: string): Promise<void> {
    const failed = await this.serialized(() =>
      this.transaction(async () => {
        const rows = await this.db.select(
          'SELECT active_build_id, previous_build_id FROM dictionary_plugin_active WHERE dictionary_id = ?',
          [dictionaryId],
        );
        const pointer = rows[0];
        if (!pointer || pointer['active_build_id'] !== buildId) {
          throw new Error(`Dictionary plugin generation is not active: ${buildId}`);
        }
        const generations = await this.db.select(
          'SELECT database_path, state FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
          [dictionaryId, buildId],
        );
        const generation = generations[0];
        if (generation?.['state'] !== 'active') return undefined;
        const databasePath = generation['database_path'];
        const previous = pointer['previous_build_id'];
        if (typeof previous !== 'string') {
          await this.db.execute('DELETE FROM dictionary_plugin_active WHERE dictionary_id = ?', [
            dictionaryId,
          ]);
          await this.db.execute(
            "UPDATE dictionary_plugin_generations SET state = 'tombstoned' WHERE dictionary_id = ? AND build_id = ?",
            [dictionaryId, buildId],
          );
          return typeof databasePath === 'string' ? databasePath : undefined;
        }
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'healthy' WHERE dictionary_id = ? AND build_id = ?",
          [dictionaryId, previous],
        );
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'tombstoned' WHERE dictionary_id = ? AND build_id = ?",
          [dictionaryId, buildId],
        );
        await this.db.execute(
          'UPDATE dictionary_plugin_active SET active_build_id = ?, previous_build_id = NULL WHERE dictionary_id = ?',
          [previous, dictionaryId],
        );
        return typeof databasePath === 'string' ? databasePath : undefined;
      }),
    );
    if (!failed) return;
    try {
      await this.deleteDatabase(failed);
      await this.db.execute(
        'DELETE FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
        [dictionaryId, buildId],
      );
    } catch {
      // Retain the tombstone for startup cleanup.
    }
  }

  async markGenerationFailed(dictionaryId: string, buildId: string): Promise<void> {
    await this.db.execute(
      "UPDATE dictionary_plugin_generations SET state = 'failed' WHERE dictionary_id = ? AND build_id = ? AND state = 'staging'",
      [dictionaryId, buildId],
    );
  }

  async discardFailedGeneration(
    dictionaryId: string,
    buildId: string,
    expectedState: 'active' | 'healthy',
  ): Promise<void> {
    const path = await this.serialized(() =>
      this.transaction(async () => {
        const pointers = await this.db.select(
          'SELECT active_build_id, previous_build_id FROM dictionary_plugin_active WHERE dictionary_id = ?',
          [dictionaryId],
        );
        const pointer = pointers[0];
        if (pointer?.['active_build_id'] !== buildId) return undefined;
        const generations = await this.db.select(
          'SELECT database_path, state FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
          [dictionaryId, buildId],
        );
        const generation = generations[0];
        if (generation?.['state'] !== expectedState) return undefined;
        const databasePath = generation['database_path'];
        const previous = pointer['previous_build_id'];
        if (typeof previous === 'string') {
          await this.db.execute(
            "UPDATE dictionary_plugin_generations SET state = 'healthy' WHERE dictionary_id = ? AND build_id = ?",
            [dictionaryId, previous],
          );
          await this.db.execute(
            'UPDATE dictionary_plugin_active SET active_build_id = ?, previous_build_id = NULL WHERE dictionary_id = ?',
            [previous, dictionaryId],
          );
        } else {
          await this.db.execute('DELETE FROM dictionary_plugin_active WHERE dictionary_id = ?', [
            dictionaryId,
          ]);
        }
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'tombstoned' WHERE dictionary_id = ? AND build_id = ?",
          [dictionaryId, buildId],
        );
        return typeof databasePath === 'string' ? databasePath : undefined;
      }),
    );
    if (!path) return;
    try {
      await this.deleteDatabase(path);
      await this.db.execute(
        'DELETE FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
        [dictionaryId, buildId],
      );
    } catch {
      // Retain the tombstone for cleanup once platform handles are released.
    }
  }

  async removeDictionary(dictionaryId: string): Promise<void> {
    const lease = await this.acquireLease(dictionaryId, 'remove');
    try {
      const generations = await this.serialized(() =>
        this.transaction(async () => {
          await this.requireLease(lease);
          const rows = await this.db.select(
            'SELECT build_id, database_path FROM dictionary_plugin_generations WHERE dictionary_id = ?',
            [dictionaryId],
          );
          await this.db.execute('DELETE FROM dictionary_plugin_active WHERE dictionary_id = ?', [
            dictionaryId,
          ]);
          await this.db.execute(
            "UPDATE dictionary_plugin_generations SET state = 'tombstoned' WHERE dictionary_id = ?",
            [dictionaryId],
          );
          return rows.map((row) => ({
            buildId: stringValue(row, 'build_id'),
            databasePath: stringValue(row, 'database_path'),
          }));
        }),
      );

      for (const generation of generations) {
        try {
          await this.deleteDatabase(generation.databasePath);
          await this.serialized(async () => {
            await this.db.execute(
              "DELETE FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ? AND state = 'tombstoned'",
              [dictionaryId, generation.buildId],
            );
          });
        } catch {
          // Keep the tombstone so startup cleanup can retry after open handles close.
        }
      }
    } finally {
      await this.releaseLease(lease);
    }
  }

  async cleanupTombstones(): Promise<void> {
    const rows = await this.db.select(
      "SELECT g.dictionary_id, g.build_id, g.database_path, g.state FROM dictionary_plugin_generations g LEFT JOIN dictionary_plugin_leases l ON l.dictionary_id = g.dictionary_id WHERE g.state IN ('tombstoned', 'failed') OR (g.state = 'staging' AND (l.dictionary_id IS NULL OR l.expires_at <= ?))",
      [this.now()],
    );
    for (const row of rows) {
      const dictionaryId = stringValue(row, 'dictionary_id');
      const buildId = stringValue(row, 'build_id');
      if (row['state'] === 'staging') {
        await this.db.execute(
          "UPDATE dictionary_plugin_generations SET state = 'tombstoned' WHERE dictionary_id = ? AND build_id = ? AND state = 'staging'",
          [dictionaryId, buildId],
        );
      }
      const path = stringValue(row, 'database_path');
      try {
        await this.deleteDatabase(path);
        await this.db.execute(
          'DELETE FROM dictionary_plugin_generations WHERE dictionary_id = ? AND build_id = ?',
          [dictionaryId, buildId],
        );
      } catch {
        // A platform may keep the SQLite/OPFS handle busy; retry next startup.
      }
    }
    await this.db.execute('DELETE FROM dictionary_plugin_leases WHERE expires_at <= ?', [
      this.now(),
    ]);
  }
}
