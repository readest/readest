import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';

export interface BenchContext {
  /** Whether to print verbose per-iteration info. */
  verbose: boolean;
}

export interface BenchResult {
  scenario: string;
  unit: 'ms' | 'us' | 'ns';
  value: number;
  /** Optional metadata: chunk count, dim, etc. */
  meta?: Record<string, string | number>;
}

export interface Bench {
  name: string;
  description: string;
  run(ctx: BenchContext): Promise<BenchResult[]>;
}

/** High-resolution timer; returns elapsed milliseconds. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  const ms = performance.now() - t0;
  return { result, ms };
}

/** Run `fn` `reps` times, return average milliseconds (after warmup). */
export async function avg(fn: () => Promise<unknown>, reps: number, warmup = 3): Promise<number> {
  for (let i = 0; i < warmup; i++) await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) await fn();
  return (performance.now() - t0) / reps;
}

/** Generate a random unit vector serialized as JSON, suitable for `vector32(?)`. */
export function randomUnitVectorJson(dim: number): string {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const x = Math.random() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) * inv;
  return JSON.stringify(Array.from(v));
}

export interface MachineInfo {
  platform: string;
  arch: string;
  cpu: string;
  cpuCount: number;
  memGiB: number;
  node: string;
  packages: Record<string, string>;
}

export function machineInfo(packages: string[] = []): MachineInfo {
  const cpuList = cpus();
  const firstCpu = cpuList[0];
  const versions: Record<string, string> = {};
  for (const name of packages) {
    try {
      const pkg = JSON.parse(readFileSync(`./node_modules/${name}/package.json`, 'utf8'));
      versions[name] = pkg.version;
    } catch {
      versions[name] = 'not installed';
    }
  }
  return {
    platform: platform(),
    arch: arch(),
    cpu: firstCpu?.model.trim() ?? 'unknown',
    cpuCount: cpuList.length,
    memGiB: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    packages: versions,
  };
}

export function formatHeader(info: MachineInfo): string {
  const lines = [
    '═'.repeat(70),
    `  Platform : ${info.platform}/${info.arch}`,
    `  CPU      : ${info.cpu} (${info.cpuCount} cores)`,
    `  Memory   : ${info.memGiB} GiB`,
    `  Node     : ${info.node}`,
  ];
  for (const [name, ver] of Object.entries(info.packages)) {
    lines.push(`  ${name.padEnd(9)}: ${ver}`);
  }
  lines.push('═'.repeat(70));
  return lines.join('\n');
}

export function formatResults(benchName: string, results: BenchResult[]): string {
  const lines = [`\n[${benchName}]`];
  for (const r of results) {
    const metaStr = r.meta
      ? `  ${Object.entries(r.meta)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`
      : '';
    lines.push(`  ${r.scenario.padEnd(40)} ${formatValue(r.value, r.unit).padStart(12)}${metaStr}`);
  }
  return lines.join('\n');
}

function formatValue(value: number, unit: 'ms' | 'us' | 'ns'): string {
  if (unit === 'ms') return `${value.toFixed(3)} ms`;
  if (unit === 'us') return `${value.toFixed(2)} µs`;
  return `${value.toFixed(0)} ns`;
}
