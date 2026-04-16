#!/usr/bin/env tsx
/**
 * Measures end-to-end book-open time: library click → reader content visible.
 *
 * Requires the dev server to be running:
 *   pnpm dev-web
 *
 * Usage:
 *   pnpm perf:open                        # "War and Peace", 3 runs
 *   pnpm perf:open "The Great Gatsby" 5   # 5 runs
 *   READEST_URL=http://localhost:3001 pnpm perf:open
 *
 * On first use, run with HEADLESS=false to import books via the UI:
 *   HEADLESS=false pnpm perf:open
 *
 * Browser profile is persisted at ~/.local/share/readest-perf so that
 * IndexedDB (your library) survives between runs.
 *
 * Two timing signals per run:
 *   wall  — Date.now() at click → Date.now() when content is confirmed visible
 *   io    — performance.now() at reader nav-start → IntersectionObserver fires
 *           on the first <iframe> inside foliate-paginator's shadow root
 */
import path from 'path';
import os from 'os';
import { firefox } from 'playwright';

const BASE_URL = process.env['READEST_URL'] ?? 'http://localhost:3000';
const BOOK_NAME = process.argv[2] ?? 'War and Peace';
const RUNS = Math.max(1, parseInt(process.argv[3] ?? '3', 10));
const HEADLESS = process.env['HEADLESS'] !== 'false';
const USER_DATA_DIR =
  process.env['USER_DATA_DIR'] ?? path.join(os.homedir(), '.local/share/readest-perf-ff');

interface RunResult {
  run: number;
  wallMs: number;
  ioMs: number | null;
}

// Declarations for values injected by addInitScript / bookProfiler exposure
declare global {
  interface Window {
    __navStart: number;
    __contentVisibleAt: number | null;
    __bookProfiler?: {
      getSessions: () => {
        bookName: string;
        startWall: number;
        entries: {
          mark: string;
          indent: number;
          wallMs: number;
          elapsedMs: number;
          deltaMs: number;
        }[];
      }[];
      formatSession: (s: {
        bookName: string;
        startWall: number;
        entries: {
          mark: string;
          indent: number;
          wallMs: number;
          elapsedMs: number;
          deltaMs: number;
        }[];
      }) => string;
    };
  }
}

async function main() {
  // Use a persistent context so IndexedDB (library) survives between runs.
  // On first use run with HEADLESS=false to import books via the UI.
  const context = await firefox.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    executablePath: path.join(os.homedir(), '.cache/ms-playwright/firefox-1511/firefox/firefox'),
  });

  const page = await context.newPage();

  const results: RunResult[] = [];

  console.log(`\nMeasuring: "${BOOK_NAME}"  (${RUNS} run${RUNS > 1 ? 's' : ''})  →  ${BASE_URL}\n`);

  for (let run = 1; run <= RUNS; run++) {
    // ── Go to library ──
    await page.goto(BASE_URL);

    // Books are rendered as div[role="button"] containing an h4 with the title.
    await page.waitForSelector(`h4:has-text("${BOOK_NAME}")`, { timeout: 15_000 });

    // ── Arm wall-clock and click in the same evaluate to minimise latency ──
    const wallBefore = await page.evaluate((name) => {
      const h4 = Array.from(document.querySelectorAll('h4')).find((h) =>
        h.textContent?.includes(name),
      );
      const card = h4?.closest<HTMLElement>('[role="button"]');
      if (!card) return null;
      const t = Date.now();
      card.click();
      return t;
    }, BOOK_NAME);

    if (wallBefore === null) {
      console.error(`  Run ${run}: could not find book card for "${BOOK_NAME}"`);
      continue;
    }

    // ── Wait for reader URL ──
    await page.waitForURL('**/reader/**', { timeout: 20_000 });

    // ── Inject IO observer now that we're on the reader page ──
    // Records __navStart and polls every 16 ms for the first iframe inside
    // foliate-paginator's shadow root (client-side nav, no page reload).
    await page.evaluate(() => {
      window.__navStart = performance.now();
      window.__contentVisibleAt = null;
      const timer = setInterval(() => {
        const view = document.querySelector('foliate-view');
        const paginator = view?.shadowRoot?.querySelector('foliate-paginator');
        const iframe = paginator?.shadowRoot?.querySelector('iframe');
        if (!iframe) return;
        clearInterval(timer);
        if (window.__contentVisibleAt === null) {
          window.__contentVisibleAt = performance.now();
        }
      }, 16);
    });

    // ── Wait until iframe mounts (io timer fires) OR spinner clears ──
    await page.waitForFunction(
      () => {
        if (window.__contentVisibleAt !== null) return true;
        const status = document.querySelector('[role="status"]');
        return status !== null && !/loading/i.test(status.textContent ?? '');
      },
      { timeout: 30_000, polling: 50 },
    );

    const wallMs = Date.now() - wallBefore;

    // ── Collect in-page timing ──
    const { navStart, contentVisibleAt } = await page.evaluate(() => ({
      navStart: window.__navStart,
      contentVisibleAt: window.__contentVisibleAt,
    }));

    // ioMs measures from when we injected the observer (≈URL change) to iframe mount.
    // It slightly lags the true nav→content time by one Playwright round-trip (~20 ms).
    const ioMs = contentVisibleAt !== null ? contentVisibleAt - navStart : null;

    results.push({ run, wallMs, ioMs });

    const ioStr = ioMs !== null ? `  io=${ioMs.toFixed(0)} ms` : '';
    console.log(`  Run ${run}/${RUNS}:  wall=${wallMs} ms${ioStr}`);
  }

  // ── Print bookProfiler session from last run ──
  const profilerOutput = await page.evaluate(() => {
    const bp = window.__bookProfiler;
    if (!bp) return null;
    const sessions = bp.getSessions();
    if (!sessions.length) return null;
    const last = sessions[sessions.length - 1];
    if (!last) return null;
    return bp.formatSession(last);
  });

  if (profilerOutput) {
    console.log('\n── bookProfiler (last run) ──\n');
    console.log(profilerOutput);
  }

  // ── Summary table ──
  printSummary(results);

  await context.close();
}

function printSummary(results: RunResult[]) {
  if (results.length < 2) return;

  const walls = results.map((r) => r.wallMs);
  const ios = results.map((r) => r.ioMs).filter((v): v is number => v !== null);

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = (arr: number[]) => Math.min(...arr);
  const max = (arr: number[]) => Math.max(...arr);

  const W = 22;
  const sep = `─${'─'.repeat(W)}─┬─${'─'.repeat(W)}─`;
  const line = (label: string, wall: string, io: string) =>
    ` ${label.padEnd(6)} │ ${wall.padStart(W)} │ ${io.padStart(W)} `;

  console.log('\n── Summary ──');
  console.log(` ${sep} `);
  console.log(line('', 'wall (click→loaded)', 'io (nav→iframe visible)'));
  console.log(` ${sep} `);
  for (const r of results) {
    const label = `run ${r.run}`;
    const wallStr = `${r.wallMs} ms`;
    const ioStr = r.ioMs !== null ? `${r.ioMs.toFixed(0)} ms` : '—';
    console.log(line(label, wallStr, ioStr));
  }
  console.log(` ${sep} `);
  console.log(
    line('avg', `${avg(walls).toFixed(0)} ms`, ios.length ? `${avg(ios).toFixed(0)} ms` : '—'),
  );
  console.log(line('min', `${min(walls)} ms`, ios.length ? `${min(ios).toFixed(0)} ms` : '—'));
  console.log(line('max', `${max(walls)} ms`, ios.length ? `${max(ios).toFixed(0)} ms` : '—'));
  console.log(` ${sep} `);
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
