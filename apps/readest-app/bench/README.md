# Benchmarks

Manual performance benchmarks for the readest-app. **Not run in CI** — CI runners
have shared-tenant variance that makes performance regression detection unreliable
(numbers swing 2-10× between runs). These exist so anyone considering an
architecture change can produce reproducible before/after numbers on their own
hardware.

## Run

```bash
pnpm bench                       # run every bench/*.bench.ts
pnpm bench vector-retrieval      # run a single benchmark by name
pnpm bench --no-record           # run but don't append to bench/results.jsonl
pnpm bench --list                # list available benchmarks
```

Refuses to run when `$CI` is set. Append `--force` to override (don't unless
you've explicitly opted into running benches in CI for a one-off investigation).

## Output

Each run prints a header with machine info (platform, CPU, Node version, key
package versions) followed by per-benchmark results. By default, results are
also appended to `bench/results.jsonl` (gitignored) — your personal local
history. To share numbers, paste the table from the terminal into a PR or issue.

## When to add a new benchmark

When you're proposing an architecture change and need numbers to defend it. The
benchmark should:

1. Live at `bench/<name>.bench.ts`.
2. Export `default { name, description, run(ctx) }` matching the type in `lib.ts`.
3. Print human-readable results to stdout and return structured results to the
   harness so they get logged to `results.jsonl`.
4. Be self-contained — no fixtures outside `bench/`, no I/O outside the bench
   directory and an in-memory database.
5. Run in under ~30 seconds at default sample sizes. If you need long-running
   scenarios, gate them behind a CLI flag.

## When *not* to add a benchmark

- "Just in case" — performance infrastructure has carrying cost. Wait until
  you have a real architecture question that numbers will answer.
- To benchmark upstream libraries' performance (e.g., raw Turso function
  throughput). That belongs in the upstream project's bench suite.
- To gate CI on performance thresholds. CI variance makes that flaky; use
  production telemetry (`reedy_metrics` table) for regression detection
  against real workloads.

## Existing benchmarks

- **`vector-retrieval`** — proves Turso's brute-force vector search is
  SIMD-accelerated and fast enough for Reedy MVP corpus sizes (sub-millisecond
  at 400 chunks × 768 dim, ~14 ms at 10K chunks × 768 dim). Established the
  decision in plan §M1.5 to skip ANN indexes (which Turso doesn't ship anyway).
