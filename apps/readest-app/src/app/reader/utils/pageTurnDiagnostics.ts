// Enabled only for an explicitly instrumented APK, never normal reader UI.
const enabled = process.env['NEXT_PUBLIC_PAGE_CURL_DIAGNOSTICS'] === '1';

export interface PageTurnMeasurement {
  draw: (progress: number) => void;
  endMotion: () => void;
  finish: () => void;
}

/** Measure first motion and JS frame intervals only in explicitly instrumented builds. */
export function measurePageTurn(startedAt: number, resident: boolean): PageTurnMeasurement | null {
  if (!enabled) return null;
  let panel = document.getElementById('page-turn-diagnostics');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'page-turn-diagnostics';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '48px',
      left: '8px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      whiteSpace: 'pre-line',
      padding: '5px 8px',
      background: '#111e',
      color: '#fff',
      font: '12px/1.4 monospace',
    });
    document.body.appendChild(panel);
  }
  panel.textContent = 'curl-timing-2 · измерение свайпа…';
  const intervals: number[] = [];
  let firstPose: number | null = null;
  let previousFrame = 0;
  let raf = 0;
  const tick = (now: number) => {
    if (firstPose !== null) {
      if (previousFrame) intervals.push(now - previousFrame);
      previousFrame = now;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const endMotion = () => cancelAnimationFrame(raf);
  return {
    draw(progress) {
      if (progress > 0 && firstPose === null) firstPose = performance.now() - startedAt;
    },
    endMotion,
    finish() {
      endMotion();
      const sorted = [...intervals].sort((a, b) => a - b);
      const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
      const max = sorted.at(-1) ?? 0;
      panel.textContent =
        `curl-timing-2 · ${resident ? 'готовые листы' : 'захват страницы'}\n` +
        `До движения: ${firstPose === null ? '—' : Math.round(firstPose)} мс\n` +
        `JS-кадры: ${intervals.length} · p95 ${Math.round(p95)} · макс ${Math.round(max)} мс`;
    },
  };
}
