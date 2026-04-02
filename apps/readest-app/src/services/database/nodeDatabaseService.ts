import { DatabaseService, DatabaseExecResult, DatabaseRow, DatabaseOpts } from '@/types/database';

interface TursoRunResult {
  changes: number;
  lastInsertRowid: number;
}

interface TursoStatement {
  run(...params: unknown[]): Promise<TursoRunResult>;
  all(...params: unknown[]): Promise<Record<string, unknown>[]>;
}

interface TursoDatabase {
  prepare(sql: string): TursoStatement;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * DatabaseService implementation backed by @tursodatabase/database (Node.js native).
 * Uses the same turso engine and API surface as the browser-based
 * @tursodatabase/database-wasm used by WebDatabaseService.
 */
export class NodeDatabaseService implements DatabaseService {
  private db: TursoDatabase;

  private constructor(db: TursoDatabase) {
    this.db = db;
  }

  static async open(path: string, opts?: DatabaseOpts): Promise<NodeDatabaseService> {
    const mod = await import('@tursodatabase/database');
    const db = (await mod.connect(path, opts)) as unknown as TursoDatabase;
    return new NodeDatabaseService(db);
  }

  async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecResult> {
    const stmt = this.db.prepare(sql);
    const result = await stmt.run(...params);
    return {
      rowsAffected: result.changes,
      lastInsertId: Number(result.lastInsertRowid),
    };
  }

  async select<T extends DatabaseRow = DatabaseRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = await stmt.all(...params);
    return rows as T[];
  }

  async batch(statements: string[]): Promise<void> {
    await this.db.exec('BEGIN');
    try {
      for (const sql of statements) {
        await this.db.exec(sql);
      }
      await this.db.exec('COMMIT');
    } catch (error: unknown) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
