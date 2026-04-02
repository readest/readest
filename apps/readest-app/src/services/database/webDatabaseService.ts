import { DatabaseService, DatabaseExecResult, DatabaseRow, DatabaseOpts } from '@/types/database';

interface WasmRunResult {
  changes: number;
  lastInsertRowid: number;
}

interface WasmStatement {
  run(...params: unknown[]): Promise<WasmRunResult>;
  all(...params: unknown[]): Promise<Record<string, unknown>[]>;
}

interface WasmDatabase {
  prepare(sql: string): WasmStatement;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export class WebDatabaseService implements DatabaseService {
  private db: WasmDatabase;

  private constructor(db: WasmDatabase) {
    this.db = db;
  }

  static async open(path: string, opts?: DatabaseOpts): Promise<WebDatabaseService> {
    const mod = await import('@tursodatabase/database-wasm');
    const db = (await mod.connect(path, opts)) as unknown as WasmDatabase;
    return new WebDatabaseService(db);
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
