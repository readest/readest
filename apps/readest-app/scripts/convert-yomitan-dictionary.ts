import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { File } from 'node:buffer';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import {
  buildYomitanIndex,
  inspectYomitanSource,
  verifyYomitanIndex,
  YOMITAN_PORTABLE_APPLICATION_ID,
  type YomitanHost,
} from '@/plugins/yomitan/importer';

const inputArg = process.argv[2];
if (!inputArg) {
  throw new Error('Usage: pnpm dictionary:yomitan:convert <input.zip> [output.rdict]');
}

const inputPath = resolve(inputArg);
const outputPath = resolve(
  process.argv[3] ?? `${inputPath.slice(0, -extname(inputPath).length)}.rdict`,
);
if (inputPath === outputPath) throw new Error('Input and output paths must differ');
if (!outputPath.toLowerCase().endsWith('.rdict')) {
  throw new Error('Portable Yomitan dictionaries must use the .rdict extension');
}
try {
  await access(outputPath);
  throw new Error(`Refusing to overwrite existing output: ${outputPath}`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Refusing to overwrite')) throw error;
}

await mkdir(dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp-${globalThis.crypto.randomUUID()}`;
const sourceBytes = await readFile(inputPath);
const source = new File([sourceBytes], basename(inputPath), { type: 'application/zip' });
const database = await NodeDatabaseService.open(temporaryPath);

const host: YomitanHost = {
  signal: new AbortController().signal,
  stat: async () => ({ name: source.name, size: source.size, type: source.type }),
  readRange: async (_handle, offset, length) => ({
    bytes: new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()),
  }),
  execute: async (_handle, sql, params = []) => database.execute(sql, params),
  select: async (_handle, sql, params = [], maxRows = 1_000) => {
    const rows = await database.select(sql, params);
    if (rows.length > maxRows) throw new Error('Portable dictionary query exceeded row limit');
    return { rows };
  },
  transaction: async (_handle, statements) => {
    await database.execute('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await database.execute(statement.sql, statement.params ?? []));
      }
      await database.execute('COMMIT');
      return { results };
    } catch (error) {
      await database.execute('ROLLBACK');
      throw error;
    }
  },
  progress: (_stage, completed, total) => {
    if (total && (completed === total || completed % 10 === 0)) {
      process.stderr.write(`Converted ${completed}/${total} banks\r`);
    }
  },
};

try {
  const inspected = await inspectYomitanSource(host, 'source');
  if (inspected.formatId !== 'yomitan') throw new Error('Input is not a raw Yomitan ZIP');
  const result = await buildYomitanIndex(
    host,
    {
      dictionaryId: 'portable-build',
      sourceHandle: 'source',
      databaseHandle: 'database',
      sourceFormatVersion: inspected.sourceFormatVersion,
    },
    { storage: 'banked' },
  );
  await verifyYomitanIndex(host, 'database');
  await database.execute(`PRAGMA application_id = ${YOMITAN_PORTABLE_APPLICATION_ID}`);
  await database.execute('PRAGMA user_version = 1');
  await database.close();
  await rename(temporaryPath, outputPath);
  process.stderr.write('\n');
  process.stdout.write(
    `${JSON.stringify({ input: inputPath, output: outputPath, title: inspected.title, ...result })}\n`,
  );
} catch (error) {
  await database.close().catch(() => undefined);
  await rm(temporaryPath, { force: true });
  throw error;
}
