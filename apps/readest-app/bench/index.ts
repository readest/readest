import { readdirSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { type Bench, type BenchResult, formatHeader, formatResults, machineInfo } from './lib.ts';

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = join(BENCH_DIR, 'results.jsonl');

interface Args {
  filter: string | null;
  record: boolean;
  list: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { filter: null, record: true, list: false, force: false };
  for (const arg of argv) {
    if (arg === '--no-record') args.record = false;
    else if (arg === '--list') args.list = true;
    else if (arg === '--force') args.force = true;
    else if (!arg.startsWith('--')) args.filter = arg;
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

async function loadBenches(): Promise<Bench[]> {
  const files = readdirSync(BENCH_DIR).filter((f) => f.endsWith('.bench.ts'));
  const benches: Bench[] = [];
  for (const file of files) {
    const mod = await import(resolve(BENCH_DIR, file));
    const bench = mod.default as Bench;
    if (!bench || typeof bench.run !== 'function') {
      console.error(`Skipping ${file}: no default export with .run()`);
      continue;
    }
    benches.push(bench);
  }
  return benches.sort((a, b) => a.name.localeCompare(b.name));
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function recordRun(bench: Bench, results: BenchResult[], commit: string): void {
  if (!existsSync(BENCH_DIR)) mkdirSync(BENCH_DIR, { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    commit,
    bench: bench.name,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    results,
  };
  appendFileSync(RESULTS_FILE, JSON.stringify(entry) + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (process.env['CI'] && !args.force) {
    console.error('Refusing to run benchmarks in CI (CI=' + process.env['CI'] + ').');
    console.error('Pass --force if you really mean it. See bench/README.md for why.');
    process.exit(1);
  }

  const benches = await loadBenches();

  if (args.list) {
    console.log('Available benchmarks:');
    for (const b of benches) console.log(`  ${b.name.padEnd(20)} ${b.description}`);
    return;
  }

  const selected = args.filter ? benches.filter((b) => b.name === args.filter) : benches;
  if (selected.length === 0) {
    console.error(`No benchmark named "${args.filter}". Try --list.`);
    process.exit(2);
  }

  const info = machineInfo(['@tursodatabase/database', '@readest/turso-database-wasm']);
  console.log(formatHeader(info));

  const commit = gitCommit();
  console.log(`  git commit : ${commit}`);
  console.log(`  recording  : ${args.record ? RESULTS_FILE : 'disabled (--no-record)'}`);
  console.log('═'.repeat(70));

  for (const bench of selected) {
    process.stdout.write(`Running ${bench.name}... `);
    const t0 = performance.now();
    const results = await bench.run({ verbose: false });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`done in ${elapsed}s`);
    console.log(formatResults(bench.name, results));
    if (args.record) recordRun(bench, results, commit);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
