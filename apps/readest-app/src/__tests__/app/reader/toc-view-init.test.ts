import { describe, it, expect, vi } from 'vitest';
import type { TOCItem } from '@/libs/document';
import { computeExpandedSet, getItemIdentifier } from '@/app/reader/components/sidebar/tocTree';

// Mirrors useFlattenedTOC logic in TOCView.tsx
const flattenTOC = (items: TOCItem[], expandedItems: Set<string>, depth = 0): TOCItem[] => {
  const result: TOCItem[] = [];
  items.forEach((item) => {
    const isExpanded = expandedItems.has(getItemIdentifier(item));
    result.push(item);
    if (item.subitems && isExpanded) {
      result.push(...flattenTOC(item.subitems, expandedItems, depth + 1));
    }
  });
  return result;
};

// Mirrors the initial-scroll-target logic in TOCView.tsx (uses the real
// computeExpandedSet). This drives the Virtuoso `initialTopMostItemIndex`
// prop, which avoids the race where a setTimeout-based scrollToIndex fires
// before Virtuoso has finished its first layout pass.
const getInitialScrollTarget = (
  toc: TOCItem[],
  href: string | undefined,
): { index: number; expanded: Set<string> } => {
  const expanded = computeExpandedSet(toc, href);
  if (!href) return { index: 0, expanded };
  const flat = flattenTOC(toc, expanded);
  const idx = flat.findIndex((item) => item.href === href);
  return { index: idx > 0 ? idx : 0, expanded };
};

/**
 * Auto-expansion policy (computeExpandedSet).
 *
 * Only the ancestors of the current reading location are "necessary" to
 * expand — a deep, multi-volume hierarchy must otherwise stay collapsed so
 * it is easy to scan (issue #4059). The single exception is a TOC wrapped in
 * one root container: collapsing it would reduce the sidebar to a single
 * uninformative row, so that lone root is expanded as a fallback.
 */
describe('TOC sidebar initialization', () => {
  const nestedTOC: TOCItem[] = [
    {
      id: 0,
      label: 'Book',
      href: undefined,
      subitems: [
        { id: 1, label: 'Chapter 1', href: 'ch1.html' },
        { id: 2, label: 'Chapter 2', href: 'ch2.html' },
        { id: 3, label: 'Chapter 3', href: 'ch3.html' },
      ],
    } as unknown as TOCItem,
  ];

  const flatTOC: TOCItem[] = [
    { id: 1, label: 'Chapter 1', href: 'ch1.html' } as unknown as TOCItem,
    { id: 2, label: 'Chapter 2', href: 'ch2.html' } as unknown as TOCItem,
    { id: 3, label: 'Chapter 3', href: 'ch3.html' } as unknown as TOCItem,
  ];

  // Mirrors a multi-volume collection ("文学必读合集20册" in issue #4059):
  // several top-level volume containers, each with their own chapters.
  const multiVolumeTOC: TOCItem[] = [
    {
      id: 0,
      label: 'Volume 1',
      href: 'v1.html',
      subitems: [
        { id: 1, label: 'V1 Chapter 1', href: 'v1c1.html' },
        { id: 2, label: 'V1 Chapter 2', href: 'v1c2.html' },
      ],
    },
    {
      id: 3,
      label: 'Volume 2',
      href: 'v2.html',
      subitems: [
        { id: 4, label: 'V2 Chapter 1', href: 'v2c1.html' },
        { id: 5, label: 'V2 Chapter 2', href: 'v2c2.html' },
      ],
    },
    {
      id: 6,
      label: 'Volume 3',
      href: 'v3.html',
      subitems: [{ id: 7, label: 'V3 Chapter 1', href: 'v3c1.html' }],
    },
  ] as unknown as TOCItem[];

  describe('single-root fallback (prevents a blank sidebar)', () => {
    it('nested TOC with no current location expands only the lone root container', () => {
      const expanded = computeExpandedSet(nestedTOC, undefined);
      expect(expanded.size).toBe(1);
      expect(expanded.has(getItemIdentifier(nestedTOC[0]!))).toBe(true);
    });

    it('nested TOC: with the root expanded, all chapters are visible', () => {
      const expanded = computeExpandedSet(nestedTOC, undefined);
      const flatItems = flattenTOC(nestedTOC, expanded);
      // Root + 3 chapters = 4 items
      expect(flatItems).toHaveLength(4);
      expect(flatItems[1]!.label).toBe('Chapter 1');
      expect(flatItems[3]!.label).toBe('Chapter 3');
    });

    it('flat TOC with no current location expands nothing', () => {
      const expanded = computeExpandedSet(flatTOC, undefined);
      expect(expanded.size).toBe(0);
    });

    it('empty TOC produces an empty expanded set', () => {
      expect(computeExpandedSet([], undefined).size).toBe(0);
    });
  });

  describe('multi-volume TOC stays collapsed (issue #4059)', () => {
    it('expands nothing when there is no current location', () => {
      const expanded = computeExpandedSet(multiVolumeTOC, undefined);
      expect(expanded.size).toBe(0);
    });

    it('shows only the collapsed volume rows when nothing is expanded', () => {
      const expanded = computeExpandedSet(multiVolumeTOC, undefined);
      const flatItems = flattenTOC(multiVolumeTOC, expanded);
      expect(flatItems.map((i) => i.label)).toEqual(['Volume 1', 'Volume 2', 'Volume 3']);
    });

    it('expands only the current volume, leaving the others collapsed', () => {
      const expanded = computeExpandedSet(multiVolumeTOC, 'v2c1.html');
      expect(expanded.has(getItemIdentifier(multiVolumeTOC[1]!))).toBe(true); // Volume 2
      expect(expanded.has(getItemIdentifier(multiVolumeTOC[0]!))).toBe(false); // Volume 1
      expect(expanded.has(getItemIdentifier(multiVolumeTOC[2]!))).toBe(false); // Volume 3
    });

    it('only the current volume reveals its chapters in the flattened list', () => {
      const expanded = computeExpandedSet(multiVolumeTOC, 'v2c1.html');
      const flatItems = flattenTOC(multiVolumeTOC, expanded);
      expect(flatItems.map((i) => i.label)).toEqual([
        'Volume 1',
        'Volume 2',
        'V2 Chapter 1',
        'V2 Chapter 2',
        'Volume 3',
      ]);
    });
  });
});

/**
 * Regression test for TOC auto-scroll race condition.
 *
 * When the TOC opens with an existing book progress, the view must scroll to
 * the current item. The previous implementation used a 300 ms setTimeout to
 * trigger `scrollToIndex` after mount. That races with Virtuoso's internal
 * layout stabilization: under load the timer occasionally fires first, the
 * TOC scrolls to the target, and then Virtuoso's late layout pass snaps the
 * list back to the top.
 *
 * Fix: compute the initial scroll target synchronously during mount so it
 * can be fed to Virtuoso's `initialTopMostItemIndex` prop, which Virtuoso
 * uses to perform the first scroll itself — no setTimeout race.
 */
describe('TOC initial scroll target', () => {
  const nestedTOC: TOCItem[] = [
    {
      id: 0,
      label: 'Book',
      href: undefined,
      subitems: [
        { id: 1, label: 'Chapter 1', href: 'ch1.html' },
        { id: 2, label: 'Chapter 2', href: 'ch2.html' },
        { id: 3, label: 'Chapter 3', href: 'ch3.html' },
      ],
    } as unknown as TOCItem,
  ];

  const flatTOC: TOCItem[] = [
    { id: 1, label: 'Chapter 1', href: 'ch1.html' } as unknown as TOCItem,
    { id: 2, label: 'Chapter 2', href: 'ch2.html' } as unknown as TOCItem,
    { id: 3, label: 'Chapter 3', href: 'ch3.html' } as unknown as TOCItem,
  ];

  it('returns index 0 when no current href is provided', () => {
    const { index, expanded } = getInitialScrollTarget(nestedTOC, undefined);
    expect(index).toBe(0);
    // Top-level container is still expanded so the list renders its chapters.
    expect(expanded.size).toBe(1);
  });

  it('resolves the current chapter inside a nested TOC with parents expanded', () => {
    const { index, expanded } = getInitialScrollTarget(nestedTOC, 'ch3.html');
    // flat order is Book, Ch1, Ch2, Ch3 → current chapter sits at index 3.
    expect(index).toBe(3);
    expect(expanded.has(getItemIdentifier(nestedTOC[0]!))).toBe(true);
  });

  it('resolves the current chapter inside a flat TOC', () => {
    const { index } = getInitialScrollTarget(flatTOC, 'ch2.html');
    expect(index).toBe(1);
  });

  it('falls back to index 0 when the href cannot be found', () => {
    const { index } = getInitialScrollTarget(nestedTOC, 'missing.html');
    expect(index).toBe(0);
  });
});

/**
 * Regression test for desktop pinned-sidebar auto-scroll failure.
 *
 * Setup: with the sidebar pinned, TOCView mounts as soon as bookData is
 * ready — BEFORE FoliateViewer emits its first relocate event. So at mount
 * time progress is null and `initialScrollTarget.index` is 0, which means
 * Virtuoso's `initialTopMostItemIndex` doesn't perform the initial scroll.
 *
 * Root cause (confirmed via on-device tracing): when progress finally
 * arrives, the post-mount progress effect (a) queues `setExpandedItems` to
 * expand the active section's parents and (b) sets `pendingScrollRef.current
 * = true`. In the SAME commit the second effect runs against the stale
 * pre-update `flatItems` (the active section's parent isn't expanded yet),
 * `findIndex` returns -1, and the old code unconditionally cleared
 * `pendingScrollRef`. By the time the next render arrives with `flatItems`
 * containing the active section, the pending flag is gone and the second
 * effect bails. Toggling the sidebar off-then-on worked around it by
 * remounting TOCView with progress already set, so Virtuoso's
 * `initialTopMostItemIndex` handled the first scroll on its own.
 *
 * Fix: leave `pendingScrollRef.current = true` when `idx === -1` so the
 * second effect retries on the next render once `flatItems` reflects the
 * expanded parents. Defensively also gate the userScrolled bail in the
 * progress effect on a `initialAutoScrollProcessedRef`, and clear pending
 * on a real user-driven scroll so a stale pending can't yank the user
 * later.
 */
describe('TOC pinned-sidebar initial auto-scroll', () => {
  type Refs = {
    userScrolled: boolean;
    pendingScroll: boolean;
    initialScrollHandled: boolean;
    initialAutoScrollProcessed: boolean;
  };

  type EffectInput = {
    isSideBarVisible: boolean;
    sideBarBookKey: string | null;
    bookKey: string;
    sectionHref: string | undefined;
  };

  // Mirrors the post-mount effect in TOCView.tsx BEFORE the fix.
  // userScrolled alone gates the early return.
  const runEffectOld = (refs: Refs, input: EffectInput): void => {
    if (!input.isSideBarVisible || input.sideBarBookKey !== input.bookKey) {
      refs.userScrolled = false;
      refs.pendingScroll = false;
      return;
    }
    if (refs.userScrolled) return;
    if (input.sectionHref) {
      if (refs.initialScrollHandled) {
        refs.initialScrollHandled = false;
      } else {
        refs.pendingScroll = true;
      }
    }
  };

  // Mirrors the post-mount effect in TOCView.tsx AFTER the fix.
  // The userScrolled gate is qualified by initialAutoScrollProcessed
  // so spurious OS-init scrolls before the first progress arrives can't
  // suppress the initial auto-scroll.
  const runEffectNew = (refs: Refs, input: EffectInput): void => {
    if (!input.isSideBarVisible || input.sideBarBookKey !== input.bookKey) {
      refs.userScrolled = false;
      refs.pendingScroll = false;
      refs.initialAutoScrollProcessed = false;
      return;
    }
    if (refs.userScrolled && refs.initialAutoScrollProcessed) return;
    if (input.sectionHref) {
      if (refs.initialScrollHandled) {
        refs.initialScrollHandled = false;
      } else {
        refs.pendingScroll = true;
      }
      refs.initialAutoScrollProcessed = true;
    }
  };

  describe('before fix (demonstrates the bug)', () => {
    it('pinned-sidebar mount + spurious OS-init scroll event suppresses the initial auto-scroll', () => {
      // Sidebar pinned: mounts before relocate. Progress is null at mount.
      const refs: Refs = {
        userScrolled: false,
        pendingScroll: false,
        initialScrollHandled: false, // index === 0 at mount, no Virtuoso initial scroll
        initialAutoScrollProcessed: false,
      };

      // First effect fire: no progress yet.
      runEffectOld(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: undefined,
      });

      // OverlayScrollbars wraps the viewport, scrollTop resets to 0, and
      // Virtuoso's onScroll handler flips the ref.
      refs.userScrolled = true;

      // FoliateViewer's first relocate finally fires.
      runEffectOld(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: 'ch3.html',
      });

      // BUG: pending scroll is never set, so the TOC stays at the top.
      expect(refs.pendingScroll).toBe(false);
    });
  });

  describe('after fix', () => {
    it('schedules pending scroll when progress arrives after mount even if a spurious scroll event was logged', () => {
      const refs: Refs = {
        userScrolled: false,
        pendingScroll: false,
        initialScrollHandled: false,
        initialAutoScrollProcessed: false,
      };

      runEffectNew(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: undefined,
      });
      expect(refs.pendingScroll).toBe(false);
      expect(refs.initialAutoScrollProcessed).toBe(false);

      refs.userScrolled = true;

      runEffectNew(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: 'ch3.html',
      });

      expect(refs.pendingScroll).toBe(true);
      expect(refs.initialAutoScrollProcessed).toBe(true);
    });

    it('still suppresses auto-scroll once the initial progress has been processed and the user scrolled', () => {
      const refs: Refs = {
        userScrolled: false,
        pendingScroll: false,
        initialScrollHandled: true, // mobile case: mounted with valid progress
        initialAutoScrollProcessed: false,
      };

      runEffectNew(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: 'ch3.html',
      });
      expect(refs.initialScrollHandled).toBe(false);
      expect(refs.pendingScroll).toBe(false);
      expect(refs.initialAutoScrollProcessed).toBe(true);

      refs.userScrolled = true;

      runEffectNew(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: 'ch5.html',
      });
      expect(refs.pendingScroll).toBe(false);
    });

    it('hide-then-show resets the processed flag so re-showing re-runs auto-scroll', () => {
      const refs: Refs = {
        userScrolled: true,
        pendingScroll: false,
        initialScrollHandled: false,
        initialAutoScrollProcessed: true,
      };

      runEffectNew(refs, {
        isSideBarVisible: false,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: 'ch3.html',
      });
      expect(refs.userScrolled).toBe(false);
      expect(refs.initialAutoScrollProcessed).toBe(false);

      runEffectNew(refs, {
        isSideBarVisible: true,
        sideBarBookKey: 'book1',
        bookKey: 'book1',
        sectionHref: 'ch3.html',
      });
      expect(refs.pendingScroll).toBe(true);
    });
  });
});

describe('TOC scroll effect retries when flatItems is stale', () => {
  type Refs = { pendingScroll: boolean };

  // Mirrors the scroll effect in TOCView.tsx BEFORE the fix: clears
  // pendingScrollRef unconditionally even when the active section is not
  // yet in flatItems.
  const runScrollOld = (
    refs: Refs,
    activeHref: string | null,
    flatItems: { href: string }[],
    onScroll: (idx: number) => void,
  ): void => {
    if (!refs.pendingScroll || !activeHref) return;
    const idx = flatItems.findIndex((f) => f.href === activeHref);
    if (idx !== -1) onScroll(idx);
    refs.pendingScroll = false; // bug: cleared even on idx === -1
  };

  // Mirrors the scroll effect AFTER the fix: leaves pendingScrollRef set
  // when idx === -1 so the next render with refreshed flatItems retries.
  const runScrollNew = (
    refs: Refs,
    activeHref: string | null,
    flatItems: { href: string }[],
    onScroll: (idx: number) => void,
  ): void => {
    if (!refs.pendingScroll || !activeHref) return;
    const idx = flatItems.findIndex((f) => f.href === activeHref);
    if (idx === -1) return; // wait for flatItems to include the section
    onScroll(idx);
    refs.pendingScroll = false;
  };

  describe('before fix (demonstrates the bug)', () => {
    it('clears pendingScroll on the stale flatItems pass and never recovers', () => {
      const refs: Refs = { pendingScroll: true };
      const scroll = vi.fn();

      // Render N: setExpandedItems was just queued by the progress
      // effect — flatItems still reflects the pre-update state and does
      // not include the deeply-nested active section.
      const staleFlat = [{ href: 'parent.html' }];
      runScrollOld(refs, 'child.html', staleFlat, scroll);
      expect(scroll).not.toHaveBeenCalled();
      expect(refs.pendingScroll).toBe(false); // BUG: cleared

      // Render N+1: flatItems now includes the active section, but
      // pendingScroll has already been cleared.
      const freshFlat = [{ href: 'parent.html' }, { href: 'child.html' }];
      runScrollNew(refs, 'child.html', freshFlat, scroll);
      expect(scroll).not.toHaveBeenCalled();
    });
  });

  describe('after fix', () => {
    it('preserves pendingScroll on stale flatItems and scrolls on the next render', () => {
      const refs: Refs = { pendingScroll: true };
      const scroll = vi.fn();

      const staleFlat = [{ href: 'parent.html' }];
      runScrollNew(refs, 'child.html', staleFlat, scroll);
      expect(scroll).not.toHaveBeenCalled();
      expect(refs.pendingScroll).toBe(true); // preserved

      const freshFlat = [{ href: 'parent.html' }, { href: 'child.html' }];
      runScrollNew(refs, 'child.html', freshFlat, scroll);
      expect(scroll).toHaveBeenCalledWith(1);
      expect(refs.pendingScroll).toBe(false);
    });

    it('clears pendingScroll once the scroll fires so it does not re-trigger', () => {
      const refs: Refs = { pendingScroll: true };
      const scroll = vi.fn();
      const flat = [{ href: 'a.html' }, { href: 'b.html' }];

      runScrollNew(refs, 'b.html', flat, scroll);
      expect(scroll).toHaveBeenCalledTimes(1);

      // A subsequent flatItems change without a new pending must not scroll again.
      runScrollNew(refs, 'b.html', flat, scroll);
      expect(scroll).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Regression test for issue #4059 follow-up: collapsed-by-default TOC drops
 * the initial auto-scroll.
 *
 * With the current volume collapsed at mount (pinned sidebar mounts before
 * the first relocate), the post-mount progress effect expands that volume,
 * growing the virtualized list from a few rows to dozens. That growth makes
 * Virtuoso emit a synthetic onScroll. The old handler treated ANY scroll
 * while a scroll was queued as "the user took over" and cleared
 * pendingScrollRef — so the one-shot auto-scroll to the current chapter was
 * silently dropped and the TOC stayed near the top.
 *
 * Fix: ignore a queued-state scroll unless a real user gesture
 * (wheel/touch/pointer/key) preceded it.
 */
describe('TOC onScroll distinguishes user scroll from expansion shift', () => {
  type Refs = { pendingScroll: boolean; userScrolled: boolean };

  // Mirrors the onScroll handler BEFORE the fix: any scroll clears pending.
  const runOnScrollOld = (refs: Refs): void => {
    refs.pendingScroll = false;
    refs.userScrolled = true;
  };

  // Mirrors the onScroll handler AFTER the fix: a scroll arriving while an
  // auto-scroll is queued is ignored unless a real user gesture preceded it.
  const runOnScrollNew = (refs: Refs, userInput: boolean): void => {
    if (refs.pendingScroll && !userInput) return;
    refs.pendingScroll = false;
    refs.userScrolled = true;
  };

  describe('before fix (demonstrates the bug)', () => {
    it('a synthetic expansion scroll clears the queued auto-scroll', () => {
      const refs: Refs = { pendingScroll: true, userScrolled: false };
      runOnScrollOld(refs);
      expect(refs.pendingScroll).toBe(false); // BUG: queued auto-scroll lost
    });
  });

  describe('after fix', () => {
    it('preserves the queued auto-scroll on a no-gesture expansion scroll', () => {
      const refs: Refs = { pendingScroll: true, userScrolled: false };
      runOnScrollNew(refs, false);
      expect(refs.pendingScroll).toBe(true);
      expect(refs.userScrolled).toBe(false);
    });

    it('lets a real user gesture cancel the queued auto-scroll', () => {
      const refs: Refs = { pendingScroll: true, userScrolled: false };
      runOnScrollNew(refs, true);
      expect(refs.pendingScroll).toBe(false);
      expect(refs.userScrolled).toBe(true);
    });

    it('records user scrolls normally once nothing is queued', () => {
      const refs: Refs = { pendingScroll: false, userScrolled: false };
      // No gesture flag needed: with nothing queued the guard does not apply.
      runOnScrollNew(refs, false);
      expect(refs.userScrolled).toBe(true);
    });
  });
});
