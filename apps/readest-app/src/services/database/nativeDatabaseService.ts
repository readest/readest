import { Database, LoadOptions, QueryResult } from 'tauri-plugin-turso';
import { DatabaseService, DatabaseExecResult, DatabaseRow, DatabaseOpts } from '@/types/database';

export class NativeDatabaseService implements DatabaseService {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(path: string, opts?: DatabaseOpts): Promise<NativeDatabaseService> {
    // Translate the cross-platform DatabaseOpts (from @readest/turso-database-common,
    // used by WASM bindings) to tauri-plugin-turso's LoadOptions. The two interfaces
    // have diverged: `experimental` is the same field name with compatible types
    // (literal union vs `string[]`); `encryption` shapes differ entirely (native
    // 'aes256cbc' + byte-array key vs WASM 'aes256gcm'/etc + hex key) and is not
    // wired in MVP — revisit alongside any Reedy.db encryption work. Skip the
    // translation when no relevant opts are set so existing callers preserve their
    // plain path-string call shape.
    const loadArg: string | LoadOptions = opts?.experimental?.length
      ? { path, experimental: opts.experimental as string[] }
      : path;
    const db = await Database.load(loadArg);
    return new NativeDatabaseService(db);
  }

  async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecResult> {
    const result: QueryResult = await this.db.execute(sql, params);
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
    };
  }

  async select<T extends DatabaseRow = DatabaseRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return await this.db.select<T[]>(sql, params);
  }

  async batch(statements: string[]): Promise<void> {
    await this.db.batch(statements);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
