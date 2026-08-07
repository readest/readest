import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { basename, resolve } from 'path';

/**
 * Regression guard: a fresh Docker deployment only ever ran
 * `docker/volumes/db/init/schema.sql` (#5550).
 *
 * `schema.sql` is the hand-written base schema; every schema change since has
 * landed as an incremental file under `docker/volumes/db/migrations/`, and
 * nothing mounted those into the db container. Self-hosters therefore booted a
 * database missing `files.replica_id`, the `replicas` table and the
 * `claim_inbox_item` RPC, so file upload, replica sync and Send to Readest all
 * failed against an otherwise healthy stack.
 *
 * The fix wires the migrations directory into the first-boot sequence, so this
 * test asserts the wiring rather than the contents of `schema.sql` — folding
 * each migration into `schema.sql` by hand is exactly the process that drifted.
 */

const DOCKER_DIR = resolve(process.cwd(), '../../docker');
const MIGRATIONS_DIR = resolve(DOCKER_DIR, 'volumes/db/migrations');
const INITDB_DIR = '/docker-entrypoint-initdb.d';

const compose = readFileSync(resolve(DOCKER_DIR, 'compose.yaml'), 'utf-8');

/** `- ./volumes/db/roles.sql:/docker-entrypoint-initdb.d/...:Z` → [source, target]. */
const dbServiceMounts = (): { source: string; target: string }[] => {
  const start = compose.indexOf('\n  db:');
  const end = compose.indexOf('\n  kong:');
  return [...compose.slice(start, end).matchAll(/^\s*- (\S+?):(\/\S+?)(?::[a-zA-Z,]+)?$/gm)].map(
    ([, source, target]) => ({ source: source!, target: target! }),
  );
};

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** Every SQL file the db container executes on first boot, in execution order. */
const bootstrapSql = (): string => {
  const mounts = dbServiceMounts();
  const files: string[] = [];

  for (const { source, target } of mounts) {
    if (target.startsWith(`${INITDB_DIR}/`) && target.endsWith('.sql')) {
      files.push(resolve(DOCKER_DIR, source));
    }
  }

  // A shell hook mounted directly under the init dir applies the migrations
  // directory; count its files only when the hook really globs that mount.
  const hook = mounts.find(
    ({ target }) => target.startsWith(`${INITDB_DIR}/`) && target.endsWith('.sh'),
  );
  const migrationsMount = mounts.find(({ source }) =>
    source.replace(/\/$/, '').endsWith('db/migrations'),
  );
  if (hook && migrationsMount) {
    const script = readFileSync(resolve(DOCKER_DIR, hook.source), 'utf-8');
    if (script.includes(`${migrationsMount.target}/*.sql`)) {
      files.push(...migrationFiles.map((name) => resolve(MIGRATIONS_DIR, name)));
    }
  }

  return files.map((file) => readFileSync(file, 'utf-8')).join('\n');
};

describe('docker db bootstrap (#5550)', () => {
  it('mounts the migrations directory into the db container', () => {
    expect(dbServiceMounts().map(({ source }) => source)).toContain('./volumes/db/migrations');
  });

  it('runs the migration hook after the supabase image applies its own schema', () => {
    const hook = dbServiceMounts().find(
      ({ target }) => target.startsWith(`${INITDB_DIR}/`) && target.endsWith('.sh'),
    );
    expect(hook).toBeDefined();
    // The image ships `${INITDB_DIR}/migrate.sh`, which creates the auth schema
    // and runs `init-scripts/100-schema.sql`. Glob order decides who goes first.
    expect(basename(hook!.target) > 'migrate.sh').toBe(true);
  });

  it('applies every migration by glob, so new ones need no compose edit', () => {
    const hook = dbServiceMounts().find(({ target }) => target.endsWith('.sh'))!;
    const script = readFileSync(resolve(DOCKER_DIR, hook.source), 'utf-8');
    const migrationsMount = dbServiceMounts().find(
      ({ source }) => source === './volumes/db/migrations',
    )!;
    expect(script).toContain(`${migrationsMount.target}/*.sql`);
  });

  it.each([
    ['files.replica_id', /ADD COLUMN IF NOT EXISTS replica_id/],
    ['files.replica_kind', /ADD COLUMN IF NOT EXISTS replica_kind/],
    ['the replicas table', /CREATE TABLE IF NOT EXISTS public\.replicas\b/],
    ['the claim_inbox_item RPC', /CREATE OR REPLACE FUNCTION public\.claim_inbox_item/],
    ['the book_shares table', /CREATE TABLE IF NOT EXISTS public\.book_shares\b/],
    ['the reading stats tables', /CREATE TABLE IF NOT EXISTS public\.stat_books\b/],
  ])('creates %s on first boot', (_label, pattern) => {
    expect(bootstrapSql()).toMatch(pattern);
  });
});
