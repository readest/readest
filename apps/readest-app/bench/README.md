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
- **`library-search`** — measures the production text and fuzzy matchers over
  deterministic corpora of real prose, half English (`bench/fixtures/alice.txt`)
  and half Chinese (`bench/fixtures/hongloumeng.txt`), sliced into 30 KB
  sections, 10 sections/book, at 10/100/1000-book library sizes (slices share
  the parent string so even the 1000-book corpus is cheap to hold). Real text
  matters: the contains matcher runs ~6× slower on real prose than on synthetic
  ASCII, and ~3× slower again on CJK. A reference macOS/arm64 run on an Apple
  M1 Pro measured ~24 ms en / ~73 ms zh for a 3 MB/10-book shelf, ~0.48 s for
  100 mixed books, ~4.8 s for a 1000-book mixed absent-query scan, ~0.55 ms
  (en) / ~3.8 ms (zh) for a common term capped at 500 matches, ~64 ms en /
  ~52 ms zh for fuzzy over a 100 KB shelf, and 7 ms en / 31 ms zh cold nearby
  (zh pays Intl.Segmenter dictionary segmentation). These numbers exclude file
  loading, EPUB/PDF parsing, and DOM text extraction.
- **`library-search-turso`** — measures the per-book `search.db` architecture
  (section text cached beside cover.png) on the same mixed en/zh corpus: build
  cost, per-DB open overhead (~1.2 ms), and query fan-out at 10/100/1000 books
  via Tantivy `fts_match`, `LIKE`, and SELECT-text + production JS matcher.
  Findings that set the architecture: the Tantivy index works (index-method
  query plan, ~0.05 ms warm lookups, flat in row count, and the default
  tokenizer matches CJK phrase queries), but at the per-book shape it cannot
  win — fan-out cost is dominated by connection open + per-connection index
  setup, so `fts_match` lands at ~2–3 ms/book vs LIKE ~1.6 ms/book and JS
  ~8 ms/book — while costing 2.3× disk (1.46 MB vs 640 KB per book) and 7×
  build time (29 ms vs 4 ms per book). The `ngram` tokenizer variant costs
  ~10× the text on disk (8.7 MB/book). FTS token/phrase semantics also cannot
  serve the substring `contains` mode, and exact offsets need the JS matcher
  pass regardless — so the shipped design stores text plus a folded-text LIKE
  prefilter column and runs the exact JS matchers on candidates, with no
  Tantivy index. (Historical note: an earlier run reported `fts_match` at
  ~6 ms/book "no faster than LIKE" — a bench bug had silently skipped index
  creation, so those numbers measured Tantivy's no-index per-row fallback.)

  **Decision:** the progressive, one-book-at-a-time scan stays as the fallback
  and cache-population path, and a persistent per-book cache is shipped on top:
  a neutral `search.db` in each book's directory (schema `library-search`)
  holding extracted section text, populated on a book's first scan and keyed on
  `(updatedAt, index version)`. Repeat searches read cached text and never open
  the book. The exact production matchers remain the arbiter for every mode;
  the folded-text LIKE prefilter only skips sections that cannot match. No
  Tantivy/ngram index — see `library-search-turso` numbers above.
