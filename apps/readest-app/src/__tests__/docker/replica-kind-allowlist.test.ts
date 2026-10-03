import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { KIND_ALLOWLIST } from '@/libs/replicaSchemas';

/**
 * The server accepts a replica kind only when both gates allow it: the API's
 * KIND_ALLOWLIST and the `replicas_kind_allowlist` CHECK in the database. A
 * kind added to the API without a migration passes validation and then fails
 * every insert.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), '../../docker/volumes/db/migrations');

/** Kinds in the last migration that (re)defines the CHECK. */
const migratedKinds = (): string[] => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  let kinds: string[] = [];
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8');
    const match = sql.match(/replicas_kind_allowlist\s+CHECK\s*\(kind IN \(([^)]*)\)\)/);
    if (match) kinds = [...match[1]!.matchAll(/'([^']+)'/g)].map(([, kind]) => kind!);
  }
  return kinds;
};

describe('replica kind allowlist', () => {
  it('allows every API kind in the database', () => {
    expect(migratedKinds()).toEqual(expect.arrayContaining(Object.keys(KIND_ALLOWLIST)));
  });
});
