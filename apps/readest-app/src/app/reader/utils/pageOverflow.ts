import type { Renderer } from '@/types/view';

// Whether a fixed-layout page (PDF, CBZ) runs past the viewport vertically, so
// its header and footer, which overlay the page, would cover its content
// (#6596): always in vertical scroll flow, where the pages run on under them,
// and when a zoomed page or horizontal flow pans vertically. Decided by layout,
// never by scroll position: showing the chrome at each page's edges made it
// flash on and off while scrolling, and on iOS every flip ended momentum
// scrolling dead.
export const isPageOverflowing = (renderer: Renderer) =>
  (renderer.scrolled && renderer.getAttribute('scroll-direction') !== 'horizontal') ||
  renderer.scrollHeight > renderer.clientHeight + 1;
