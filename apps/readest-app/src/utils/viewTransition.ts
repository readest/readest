/**
 * Whether the engine implements the View Transitions API at all
 * (`document.startViewTransition`). This is the baseline a simple route
 * crossfade needs, and it lands broadly: Chrome 111+, Edge, Safari 18+, and
 * recent Android WebView.
 */
export const detectViewTransitionsAPI = (): boolean =>
  typeof document !== 'undefined' && 'startViewTransition' in document;

/**
 * Whether the engine also supports nested view-transition groups
 * (`view-transition-group: nearest`, Chrome/WebView 140+) - a far narrower
 * target than the base API. This is what the paginator's layered turns
 * require: iOS 18 WebKit ships `startViewTransition` but crashes the
 * WebContent process on layered snapshots, so the group query marks the
 * mature engines where the layered turns are known to work.
 */
export const detectViewTransitionGroup = (): boolean =>
  detectViewTransitionsAPI() &&
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('view-transition-group', 'nearest');

const waitUntil = async (ready: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (!ready() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 16));
};

/**
 * Animate leaving a page whose teardown would otherwise be visible (the
 * reader closing its books before the library mounts). The view transition
 * captures the page first, so `leave` and the destination's first renders run
 * under that snapshot until `arrived` reports the new page is drawn (or
 * `timeoutMs` passes), and only then does the slide start. Polled with
 * timers, since rendering is paused while the snapshot is held.
 */
export const transitionAway = async (
  leave: () => Promise<void>,
  arrived: () => boolean,
  direction: 'forward' | 'back',
  timeoutMs = 1000,
) => {
  if (!detectViewTransitionsAPI()) return leave();
  const root = document.documentElement;
  root.setAttribute('data-nav-direction', direction);
  const transition = document.startViewTransition(async () => {
    await leave();
    await waitUntil(arrived, timeoutMs);
  });
  // A skipped animation is fine; a failed `leave` still surfaces below.
  void transition.ready.catch(() => {});
  // Handled up front: `finished` also rejects when `leave` does.
  const finished = transition.finished.catch(() => {});
  try {
    await transition.updateCallbackDone;
    await finished;
  } finally {
    root.removeAttribute('data-nav-direction');
  }
};
