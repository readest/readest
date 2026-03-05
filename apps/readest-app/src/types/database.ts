export type { DatabaseOpts } from '@tursodatabase/database-common';

export interface DatabaseExecResult {
  rowsAffected: number;
  lastInsertId: number;
}

export type DatabaseRow = Record<string, unknown>;

export interface DatabaseService {
  execute(sql: string, params?: unknown[]): Promise<DatabaseExecResult>;
  select<T extends DatabaseRow = DatabaseRow>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: string[]): Promise<void>;
  close(): Promise<void>;
}
