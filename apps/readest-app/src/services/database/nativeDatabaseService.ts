import { Database, QueryResult } from 'tauri-plugin-turso';
import { DatabaseService, DatabaseExecResult, DatabaseRow, DatabaseOpts } from '@/types/database';

export class NativeDatabaseService implements DatabaseService {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(path: string, _opts?: DatabaseOpts): Promise<NativeDatabaseService> {
    const db = await Database.load(path);
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
