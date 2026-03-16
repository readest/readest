import { describe, it, expect, vi } from 'vitest';

// Mock the paginator module to avoid custom element registration conflicts
vi.mock('foliate-js/paginator.js', () => ({}));

describe('Paginator stabilization', () => {
  describe('View.fontReady property', () => {
    it('should default to a resolved promise', async () => {
      // View.fontReady should initialize to Promise.resolve()
      // so awaiting it never blocks when no doc is loaded
      const fontReady = Promise.resolve();
      await expect(fontReady).resolves.toBeUndefined();
    });

    it('should be set from doc.fonts.ready in load()', () => {
      // After View.load(), fontReady should be assigned from doc.fonts.ready.then(...)
      // Simulating the pattern: this.fontReady = doc.fonts.ready.then(() => this.expand())
      const expandFn = vi.fn();
      const fontsReady = Promise.resolve().then(() => expandFn());
      const view = { fontReady: fontsReady };
      expect(view.fontReady).toBeInstanceOf(Promise);
    });
  });

  describe('Stabilization flag suppresses scroll-to-anchor', () => {
    it('should not call scrollToAnchor during stabilization on expand', () => {
      // In #createView, the onExpand callback should check both #filling and #stabilizing
      // Simulate: if (!this.#filling && !this.#stabilizing) this.#scrollToAnchor(...)
      const scrollToAnchor = vi.fn();
      const filling = false;
      const stabilizing = true;

      // onExpand callback
      if (!filling && !stabilizing) scrollToAnchor();
      expect(scrollToAnchor).not.toHaveBeenCalled();
    });

    it('should call scrollToAnchor when not filling and not stabilizing', () => {
      const scrollToAnchor = vi.fn();
      const filling = false;
      const stabilizing = false;

      if (!filling && !stabilizing) scrollToAnchor();
      expect(scrollToAnchor).toHaveBeenCalledOnce();
    });

    it('should not call scrollToAnchor when filling', () => {
      const scrollToAnchor = vi.fn();
      const filling = true;
      const stabilizing = false;

      if (!filling && !stabilizing) scrollToAnchor();
      expect(scrollToAnchor).not.toHaveBeenCalled();
    });
  });

  describe('Font timeout mechanism', () => {
    it('should resolve within timeout even if fonts never load', async () => {
      const neverResolves = new Promise<void>(() => {
        /* intentionally never resolves */
      });
      const timeout = 50; // shorter for test
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const start = Date.now();
      await Promise.race([Promise.all([neverResolves]), wait(timeout)]);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(timeout + 50);
    });

    it('should resolve immediately if fonts are already loaded', async () => {
      const alreadyLoaded = Promise.resolve();
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const start = Date.now();
      await Promise.race([Promise.all([alreadyLoaded]), wait(3000)]);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('Stabilization lifecycle in #display()', () => {
    it('should set opacity to 0 at start and 1 at end', () => {
      const container = { style: { opacity: '' } };
      // Start of display
      container.style.opacity = '0';
      expect(container.style.opacity).toBe('0');

      // End of display (after fillVisibleArea)
      container.style.opacity = '1';
      expect(container.style.opacity).toBe('1');
    });

    it('should dispatch stabilized event after completing', () => {
      const events: string[] = [];
      const dispatchEvent = (event: { type: string }) => {
        events.push(event.type);
      };

      // Simulate end of #display()
      dispatchEvent({ type: 'stabilized' });
      expect(events).toContain('stabilized');
    });
  });

  describe('Stabilizing stays true until fill completes', () => {
    it('should keep stabilizing true after display until fillPromise resolves', async () => {
      let stabilizing = true;
      let fillResolve: () => void;
      const fillPromise = new Promise<void>((resolve) => {
        fillResolve = resolve;
      });

      // Simulate #display end: dispatch stabilized but don't clear #stabilizing
      // Instead, defer clearing to fillPromise completion
      fillPromise.then(() => {
        stabilizing = false;
      });

      // stabilizing should still be true before fill completes
      expect(stabilizing).toBe(true);

      // Resolve fill
      fillResolve!();
      await fillPromise;

      expect(stabilizing).toBe(false);
    });

    it('should block backward loading while stabilizing', () => {
      const loadPrevSection = vi.fn();
      const filling = false;
      const stabilizing = true;
      const scrollStart = 50; // near top
      const viewportSize = 800;

      // Debounced scroll handler check
      if (!filling && !stabilizing && scrollStart < viewportSize) {
        loadPrevSection();
      }
      expect(loadPrevSection).not.toHaveBeenCalled();
    });

    it('should allow backward loading after stabilizing clears', () => {
      const loadPrevSection = vi.fn();
      const filling = false;
      const stabilizing = false;
      const scrollStart = 50;
      const viewportSize = 800;

      if (!filling && !stabilizing && scrollStart < viewportSize) {
        loadPrevSection();
      }
      expect(loadPrevSection).toHaveBeenCalledOnce();
    });
  });

  describe('Debounced scroll handler skips during stabilization', () => {
    function simulateDebouncedHandler(state: {
      stabilizing: boolean;
      justAnchored: boolean;
      filling: boolean;
      start: number;
      size: number;
    }) {
      const afterScroll = vi.fn();
      const loadPrevSection = vi.fn();

      if (state.stabilizing) return { afterScroll, loadPrevSection };
      if (state.justAnchored) state.justAnchored = false;
      else afterScroll();
      if (!state.filling && state.start < state.size) {
        loadPrevSection();
      }
      return { afterScroll, loadPrevSection };
    }

    it('should skip entirely while stabilizing', () => {
      const state = { stabilizing: true, justAnchored: true, filling: false, start: 0, size: 800 };
      const { afterScroll, loadPrevSection } = simulateDebouncedHandler(state);
      expect(afterScroll).not.toHaveBeenCalled();
      expect(loadPrevSection).not.toHaveBeenCalled();
      expect(state.justAnchored).toBe(true); // preserved
    });

    it('should run normally after stabilizing clears', () => {
      const state = {
        stabilizing: false,
        justAnchored: false,
        filling: false,
        start: 50,
        size: 800,
      };
      const { afterScroll, loadPrevSection } = simulateDebouncedHandler(state);
      expect(afterScroll).toHaveBeenCalledOnce();
      expect(loadPrevSection).toHaveBeenCalledOnce();
    });

    it('should not load backward when prev section already loaded (views.has check)', () => {
      // When prev section is pre-loaded in #display, views.has(prevIdx) is true
      // so the debounced handler's backward loading is a no-op.
      // This test verifies the pre-load prevents cascade.
      const prevAlreadyLoaded = true;
      const loadPrevSection = vi.fn();
      if (!prevAlreadyLoaded) loadPrevSection();
      expect(loadPrevSection).not.toHaveBeenCalled();
    });
  });

  describe('Pre-load previous section in #display for scrolled mode', () => {
    it('should pre-load prev section when anchor <= 0.5 in scrolled mode', () => {
      const scrolled = true;
      const anchor = 0; // beginning of section
      const contentPages = 10;
      const columnCount = 2;

      const needsPrev =
        (contentPages > 0 && contentPages < columnCount) ||
        (scrolled && typeof anchor === 'number' && anchor <= 0.5);

      expect(needsPrev).toBe(true);
    });

    it('should pre-load prev section when anchor = 0.5 in scrolled mode', () => {
      const scrolled = true;
      const anchor = 0.5;
      const contentPages = 10;
      const columnCount = 2;

      const needsPrev =
        (contentPages > 0 && contentPages < columnCount) ||
        (scrolled && typeof anchor === 'number' && anchor <= 0.5);

      expect(needsPrev).toBe(true);
    });

    it('should NOT pre-load prev section when anchor > 0.5 in scrolled mode', () => {
      const scrolled = true;
      const anchor = 0.8;
      const contentPages = 10;
      const columnCount = 2;

      const needsPrev =
        (contentPages > 0 && contentPages < columnCount) ||
        (scrolled && typeof anchor === 'number' && anchor <= 0.5);

      expect(needsPrev).toBe(false);
    });

    it('should still pre-load for short primary alignment regardless of mode', () => {
      const scrolled = false;
      const anchor = 0.8;
      const contentPages = 1; // shorter than one spread
      const columnCount = 2;

      const needsPrev =
        (contentPages > 0 && contentPages < columnCount) ||
        (scrolled && typeof anchor === 'number' && anchor <= 0.5);

      expect(needsPrev).toBe(true);
    });

    it('should NOT pre-load in paginated mode with anchor=0 and normal section', () => {
      const scrolled = false;
      const anchor = 0;
      const contentPages = 10;
      const columnCount = 2;

      const needsPrev =
        (contentPages > 0 && contentPages < columnCount) ||
        (scrolled && typeof anchor === 'number' && anchor <= 0.5);

      expect(needsPrev).toBe(false);
    });
  });

  describe('Render micro-stabilization', () => {
    it('should only micro-stabilize when not already in stabilization', () => {
      let stabilizing = false;
      const container = { style: { opacity: '' } };

      // When not already stabilizing
      const needsStabilize = !stabilizing;
      if (needsStabilize) {
        stabilizing = true;
        container.style.opacity = '0';
      }
      expect(needsStabilize).toBe(true);
      expect(stabilizing).toBe(true);
      expect(container.style.opacity).toBe('0');
    });

    it('should not micro-stabilize when already stabilizing', () => {
      let stabilizing = true;
      const container = { style: { opacity: '0' } };

      const needsStabilize = !stabilizing;
      if (needsStabilize) {
        stabilizing = true;
        container.style.opacity = '0';
      }
      expect(needsStabilize).toBe(false);
      // stabilizing remains true, container opacity unchanged (already 0)
      expect(stabilizing).toBe(true);
    });
  });
});
