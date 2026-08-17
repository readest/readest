import type { DatabaseExecResult, DatabaseRow, DatabaseService } from '@/types/database';
import {
  MAX_PLUGIN_RESOURCE_BYTES,
  MAX_PLUGIN_SQL_PARAMETER_BYTES,
  MAX_PLUGIN_SQL_PARAMS,
  MAX_PLUGIN_SQL_REQUEST_BYTES,
  pluginSqlValueBytes,
} from './contract';

export interface PluginScope {
  pluginId: string;
  dictionaryId?: string;
}

interface SourceStatRequest {
  handle: string;
}

interface SourceReadRangeRequest {
  handle: string;
  offset: number;
  length: number;
}

interface SourceLike extends Blob {
  readonly name: string;
  readonly lastModified?: number;
}

interface SourceEntry {
  scope: PluginScope;
  source: SourceLike;
}

interface SourceBrokerOptions {
  maxReadBytes?: number;
  createHandle?: () => string;
}

interface SqlStatement {
  sql: string;
  params?: unknown[];
}

interface SqlExecuteRequest extends SqlStatement {
  handle: string;
}

interface SqlSelectRequest extends SqlExecuteRequest {
  maxRows: number;
}

interface SqlTransactionRequest {
  handle: string;
  statements: SqlStatement[];
}

type SqlMode = 'active' | 'staging';

interface SqlEntry {
  scope: PluginScope;
  db: DatabaseService;
  mode: SqlMode;
  tail: Promise<void>;
}

interface SqlBrokerOptions {
  maxRows?: number;
  maxSqlBytes?: number;
  maxParams?: number;
  maxParamBytes?: number;
  maxParamCellBytes?: number;
  maxResultBytes?: number;
  maxResultCellBytes?: number;
  maxTransactionStatements?: number;
  createHandle?: () => string;
}

export class PluginBrokerError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PluginBrokerError';
  }
}

const opaqueHandle = (prefix: string): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const token = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${token}`;
};

const sameScope = (left: PluginScope, right: PluginScope): boolean =>
  left.pluginId === right.pluginId && left.dictionaryId === right.dictionaryId;

export class SourceBroker {
  private readonly entries = new Map<string, SourceEntry>();
  private readonly maxReadBytes: number;
  private readonly createHandle: () => string;

  constructor(options: SourceBrokerOptions = {}) {
    this.maxReadBytes = options.maxReadBytes ?? 4 * 1_024 * 1_024;
    this.createHandle = options.createHandle ?? (() => opaqueHandle('source'));
  }

  register(scope: PluginScope, source: SourceLike): string {
    const handle = this.createHandle();
    this.entries.set(handle, { scope: { ...scope }, source });
    return handle;
  }

  revoke(handle: string): void {
    this.entries.delete(handle);
  }

  rebind(handle: string, scope: PluginScope): void {
    const entry = this.entries.get(handle);
    if (!entry) throw new PluginBrokerError('Unknown source handle', 'UNKNOWN_SOURCE_HANDLE');
    if (entry.scope.pluginId !== scope.pluginId) {
      throw new PluginBrokerError(
        'Source handle is outside the plugin scope',
        'SOURCE_SCOPE_DENIED',
      );
    }
    entry.scope = { ...scope };
  }

  private require(scope: PluginScope, handle: string): SourceEntry {
    const entry = this.entries.get(handle);
    if (!entry) throw new PluginBrokerError('Unknown source handle', 'UNKNOWN_SOURCE_HANDLE');
    if (!sameScope(entry.scope, scope)) {
      throw new PluginBrokerError(
        'Source handle is outside the plugin scope',
        'SOURCE_SCOPE_DENIED',
      );
    }
    return entry;
  }

  async stat(scope: PluginScope, request: SourceStatRequest) {
    const source = this.require(scope, request.handle).source;
    return {
      name: source.name,
      size: source.size,
      type: source.type,
      ...(source.lastModified === undefined ? {} : { lastModified: source.lastModified }),
    };
  }

  async readRange(scope: PluginScope, request: SourceReadRangeRequest) {
    const source = this.require(scope, request.handle).source;
    if (!Number.isSafeInteger(request.offset) || !Number.isSafeInteger(request.length)) {
      throw new PluginBrokerError('Source range must use safe integers', 'INVALID_SOURCE_RANGE');
    }
    if (request.length > this.maxReadBytes) {
      throw new PluginBrokerError('Source read exceeds the per-call limit', 'SOURCE_READ_LIMIT');
    }
    const end = request.offset + request.length;
    if (request.offset < 0 || request.length < 0 || end > source.size) {
      throw new PluginBrokerError('Source read is outside file bounds', 'SOURCE_RANGE_BOUNDS');
    }
    const bytes = new Uint8Array(await source.slice(request.offset, end).arrayBuffer());
    return { bytes };
  }
}

const normalizeSql = (sql: string): { statement: string; analysis: string } => {
  let analysis = '';
  let state: 'plain' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block' = 'plain';
  let semicolon = -1;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (state === 'line') {
      if (char === '\n') {
        state = 'plain';
        analysis += ' ';
      }
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'plain';
        index += 1;
        analysis += ' ';
      }
      continue;
    }
    if (state === 'single') {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = 'plain';
      analysis += ' ';
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') state = 'plain';
      analysis += ' ';
      continue;
    }
    if (state === 'backtick') {
      if (char === '`') state = 'plain';
      analysis += ' ';
      continue;
    }
    if (state === 'bracket') {
      if (char === ']') state = 'plain';
      analysis += ' ';
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line';
      index += 1;
      analysis += ' ';
    } else if (char === '/' && next === '*') {
      state = 'block';
      index += 1;
      analysis += ' ';
    } else if (char === "'") {
      state = 'single';
      analysis += ' ';
    } else if (char === '"') {
      state = 'double';
      analysis += ' ';
    } else if (char === '`') {
      state = 'backtick';
      analysis += ' ';
    } else if (char === '[') {
      state = 'bracket';
      analysis += ' ';
    } else {
      if (char === ';') semicolon = index;
      analysis += char;
    }
  }
  if (state !== 'plain' && state !== 'line') {
    throw new PluginBrokerError('Unterminated SQL token is not allowed', 'SQL_NOT_ALLOWED');
  }
  const trailingStart = sql.trimEnd().endsWith(';') ? sql.trimEnd().length - 1 : -1;
  if (semicolon >= 0 && semicolon !== trailingStart) {
    throw new PluginBrokerError('Multiple SQL statements are not allowed', 'SQL_NOT_ALLOWED');
  }
  const statement = trailingStart >= 0 ? sql.slice(0, trailingStart).trim() : sql.trim();
  const cleanAnalysis = trailingStart >= 0 ? analysis.slice(0, trailingStart) : analysis;
  return { statement, analysis: cleanAnalysis.toUpperCase().replace(/\s+/gu, ' ').trim() };
};

const assertParams = (
  params: unknown[],
  maxParams: number,
  maxParamBytes: number,
  maxParamCellBytes: number,
  budget = { bytes: 0 },
): void => {
  if (params.length > maxParams) {
    throw new PluginBrokerError('SQL parameter limit exceeded', 'SQL_PARAMETER_LIMIT');
  }
  for (const value of params) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'bigint' &&
      typeof value !== 'boolean' &&
      !(value instanceof Uint8Array)
    ) {
      throw new PluginBrokerError('Unsupported SQL parameter type', 'SQL_PARAMETER_TYPE');
    }
    const bytes = pluginSqlValueBytes(value);
    if (bytes > maxParamCellBytes) {
      throw new PluginBrokerError(
        'SQL parameter cell size limit exceeded',
        'SQL_PARAMETER_SIZE_LIMIT',
      );
    }
    budget.bytes += bytes;
    if (budget.bytes > maxParamBytes) {
      throw new PluginBrokerError(
        'SQL parameter payload size limit exceeded',
        'SQL_PARAMETER_SIZE_LIMIT',
      );
    }
  }
};

const normalizeSqlResultValue = (
  value: unknown,
  maxCellBytes: number,
): { bytes: number; value: unknown } => {
  if (value === null) return { bytes: 0, value };
  if (typeof value === 'string') {
    return { bytes: new TextEncoder().encode(value).byteLength, value };
  }
  if (typeof value === 'number' || typeof value === 'bigint') return { bytes: 8, value };
  if (typeof value === 'boolean') return { bytes: 1, value };
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > maxCellBytes) {
      throw new PluginBrokerError('SQL result cell size limit exceeded', 'SQL_RESULT_LIMIT');
    }
    return { bytes: value.byteLength, value: new Uint8Array(value) };
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength > maxCellBytes) {
      throw new PluginBrokerError('SQL result cell size limit exceeded', 'SQL_RESULT_LIMIT');
    }
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    return { bytes: bytes.byteLength, value: bytes };
  }
  if (Array.isArray(value)) {
    if (value.length > maxCellBytes) {
      throw new PluginBrokerError('SQL result cell size limit exceeded', 'SQL_RESULT_LIMIT');
    }
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const byte = value[index];
      if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new PluginBrokerError('Unsupported SQL result type', 'SQL_RESULT_TYPE');
      }
      bytes[index] = byte;
    }
    return { bytes: bytes.byteLength, value: bytes };
  }
  throw new PluginBrokerError('Unsupported SQL result type', 'SQL_RESULT_TYPE');
};

const normalizeSqlResultRows = (
  rows: DatabaseRow[],
  maxResultBytes: number,
  maxResultCellBytes: number,
): DatabaseRow[] => {
  const encoder = new TextEncoder();
  let totalBytes = 0;
  return rows.map((row) => {
    const normalized: DatabaseRow = {};
    for (const [key, value] of Object.entries(row)) {
      const cell = normalizeSqlResultValue(value, maxResultCellBytes);
      if (cell.bytes > maxResultCellBytes) {
        throw new PluginBrokerError('SQL result cell size limit exceeded', 'SQL_RESULT_LIMIT');
      }
      totalBytes += encoder.encode(key).byteLength + cell.bytes;
      if (totalBytes > maxResultBytes) {
        throw new PluginBrokerError('SQL result size limit exceeded', 'SQL_RESULT_LIMIT');
      }
      normalized[key] = cell.value;
    }
    return normalized;
  });
};

export class SqlBroker {
  private readonly entries = new Map<string, SqlEntry>();
  private readonly maxRows: number;
  private readonly maxSqlBytes: number;
  private readonly maxParams: number;
  private readonly maxParamBytes: number;
  private readonly maxParamCellBytes: number;
  private readonly maxResultBytes: number;
  private readonly maxResultCellBytes: number;
  private readonly maxTransactionStatements: number;
  private readonly createHandle: () => string;

  constructor(options: SqlBrokerOptions = {}) {
    this.maxRows = options.maxRows ?? 1_000;
    this.maxSqlBytes = options.maxSqlBytes ?? 65_536;
    this.maxParams = options.maxParams ?? MAX_PLUGIN_SQL_PARAMS;
    this.maxParamBytes = options.maxParamBytes ?? MAX_PLUGIN_SQL_REQUEST_BYTES;
    this.maxParamCellBytes = options.maxParamCellBytes ?? MAX_PLUGIN_SQL_PARAMETER_BYTES;
    this.maxResultBytes = options.maxResultBytes ?? MAX_PLUGIN_RESOURCE_BYTES * 2;
    this.maxResultCellBytes = options.maxResultCellBytes ?? MAX_PLUGIN_RESOURCE_BYTES;
    this.maxTransactionStatements = options.maxTransactionStatements ?? 64;
    this.createHandle = options.createHandle ?? (() => opaqueHandle('database'));
  }

  async register(scope: PluginScope, db: DatabaseService, mode: SqlMode): Promise<string> {
    if (mode === 'active') await db.execute('PRAGMA query_only = 1');
    const handle = this.createHandle();
    this.entries.set(handle, { scope: { ...scope }, db, mode, tail: Promise.resolve() });
    return handle;
  }

  revoke(handle: string): void {
    this.entries.delete(handle);
  }

  private require(scope: PluginScope, handle: string): SqlEntry {
    const entry = this.entries.get(handle);
    if (!entry) throw new PluginBrokerError('Unknown database handle', 'UNKNOWN_DATABASE_HANDLE');
    if (!sameScope(entry.scope, scope)) {
      throw new PluginBrokerError(
        'Database handle is outside the plugin scope',
        'DATABASE_SCOPE_DENIED',
      );
    }
    return entry;
  }

  private validate(
    entry: SqlEntry,
    sql: string,
    params: unknown[],
    operation: 'read' | 'write',
  ): string {
    if (new TextEncoder().encode(sql).byteLength > this.maxSqlBytes) {
      throw new PluginBrokerError('SQL length limit exceeded', 'SQL_LENGTH_LIMIT');
    }
    assertParams(params, this.maxParams, this.maxParamBytes, this.maxParamCellBytes);
    const normalized = normalizeSql(sql);
    const first = normalized.analysis.split(' ')[0] ?? '';
    const forbidden = /\b(?:ATTACH|DETACH|VACUUM|LOAD_EXTENSION)\b/u.test(normalized.analysis);
    if (forbidden || first === 'PRAGMA') {
      throw new PluginBrokerError('SQL statement is not allowed', 'SQL_NOT_ALLOWED');
    }
    if (entry.mode === 'active' && (operation !== 'read' || !['SELECT', 'WITH'].includes(first))) {
      throw new PluginBrokerError('Active plugin databases are read-only', 'DATABASE_READ_ONLY');
    }
    const stagingAllowed = [
      'ALTER',
      'CREATE',
      'DELETE',
      'DROP',
      'INSERT',
      'REPLACE',
      'SELECT',
      'UPDATE',
      'WITH',
    ];
    if (entry.mode === 'staging' && !stagingAllowed.includes(first)) {
      throw new PluginBrokerError('SQL statement is not allowed', 'SQL_NOT_ALLOWED');
    }
    if (operation === 'read' && !['SELECT', 'WITH'].includes(first)) {
      throw new PluginBrokerError('SQL select capability only accepts queries', 'SQL_NOT_ALLOWED');
    }
    return normalized.statement;
  }

  private async locked<T>(entry: SqlEntry, action: () => Promise<T>): Promise<T> {
    const run = entry.tail.then(action, action);
    entry.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async execute(scope: PluginScope, request: SqlExecuteRequest): Promise<DatabaseExecResult> {
    const entry = this.require(scope, request.handle);
    return this.locked(entry, async () => {
      const params = request.params ?? [];
      const sql = this.validate(entry, request.sql, params, 'write');
      return entry.db.execute(sql, params);
    });
  }

  async select(scope: PluginScope, request: SqlSelectRequest): Promise<{ rows: DatabaseRow[] }> {
    const entry = this.require(scope, request.handle);
    return this.locked(entry, async () => {
      if (request.maxRows < 1 || request.maxRows > this.maxRows) {
        throw new PluginBrokerError('Requested SQL row limit is not allowed', 'SQL_ROW_LIMIT');
      }
      const params = request.params ?? [];
      const sql = this.validate(entry, request.sql, params, 'read');
      const rows = await entry.db.select(`SELECT * FROM (${sql}) AS plugin_query LIMIT ?`, [
        ...params,
        request.maxRows + 1,
      ]);
      if (rows.length > request.maxRows) {
        throw new PluginBrokerError('SQL row limit exceeded', 'SQL_ROW_LIMIT');
      }
      return {
        rows: normalizeSqlResultRows(rows, this.maxResultBytes, this.maxResultCellBytes),
      };
    });
  }

  async transaction(
    scope: PluginScope,
    request: SqlTransactionRequest,
  ): Promise<{ results: DatabaseExecResult[] }> {
    const entry = this.require(scope, request.handle);
    if (entry.mode !== 'staging') {
      throw new PluginBrokerError('Active plugin databases are read-only', 'DATABASE_READ_ONLY');
    }
    if (
      request.statements.length < 1 ||
      request.statements.length > this.maxTransactionStatements
    ) {
      throw new PluginBrokerError(
        'SQL transaction statement limit exceeded',
        'SQL_STATEMENT_LIMIT',
      );
    }
    return this.locked(entry, async () => {
      const parameterBudget = { bytes: 0 };
      const statements = request.statements.map((statement) => {
        const params = statement.params ?? [];
        assertParams(
          params,
          this.maxParams,
          this.maxParamBytes,
          this.maxParamCellBytes,
          parameterBudget,
        );
        return {
          sql: this.validate(entry, statement.sql, [], 'write'),
          params,
        };
      });
      const results: DatabaseExecResult[] = [];
      await entry.db.execute('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) {
          results.push(await entry.db.execute(statement.sql, statement.params));
        }
        await entry.db.execute('COMMIT');
        return { results };
      } catch (error) {
        try {
          await entry.db.execute('ROLLBACK');
        } catch {
          // Preserve the statement failure; the host discards this staging DB.
        }
        throw error;
      }
    });
  }
}
