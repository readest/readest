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
