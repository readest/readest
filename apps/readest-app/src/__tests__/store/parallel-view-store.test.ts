import { describe, test, expect, beforeEach } from 'vitest';
import { useParallelViewStore } from '@/store/parallelViewStore';

beforeEach(() => {
  useParallelViewStore.setState({ parallelViews: [] });
});

describe('parallelViewStore', () => {
  // ── setParallel ──────────────────────────────────────────────────
  describe('setParallel', () => {
    test('creates a new parallel group from two keys', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.has('a')).toBe(true);
      expect(groups[0]!.has('b')).toBe(true);
    });

    test('requires at least 2 unique keys to create a group', () => {
      useParallelViewStore.getState().setParallel(['a']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(0);
    });

    test('returns current state when fewer than 2 unique keys', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
    });

    test('filters out empty and whitespace-only keys', () => {
      useParallelViewStore.getState().setParallel(['a', '', '  ', 'b']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.size).toBe(2);
      expect(groups[0]!.has('a')).toBe(true);
      expect(groups[0]!.has('b')).toBe(true);
    });

    test('returns state unchanged if all keys are empty', () => {
      useParallelViewStore.getState().setParallel(['', '  ']);

      expect(useParallelViewStore.getState().parallelViews).toHaveLength(0);
    });

    test('deduplicates keys', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'a', 'b']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.size).toBe(2);
    });

    test('adds keys to an existing group when one key already belongs', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['b', 'c']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.has('a')).toBe(true);
      expect(groups[0]!.has('b')).toBe(true);
      expect(groups[0]!.has('c')).toBe(true);
    });

    test('merges two existing groups when keys span them', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);

      // Now bridge the two groups
      useParallelViewStore.getState().setParallel(['b', 'c']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.has('a')).toBe(true);
      expect(groups[0]!.has('b')).toBe(true);
      expect(groups[0]!.has('c')).toBe(true);
      expect(groups[0]!.has('d')).toBe(true);
    });

    test('creates independent groups for non-overlapping keys', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(2);
    });

    test('handles three or more keys at once', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'c', 'd']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.size).toBe(4);
    });

    test('merges more than two existing groups', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);
      useParallelViewStore.getState().setParallel(['e', 'f']);

      // Bridge all three
      useParallelViewStore.getState().setParallel(['a', 'c', 'e']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.size).toBe(6);
    });
  });

  // ── unsetParallel ────────────────────────────────────────────────
  describe('unsetParallel', () => {
    test('removes keys from a group', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'c']);
      useParallelViewStore.getState().unsetParallel(['c']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.has('c')).toBe(false);
      expect(groups[0]!.has('a')).toBe(true);
      expect(groups[0]!.has('b')).toBe(true);
    });

    test('removes the group entirely when it has 1 or fewer members left', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().unsetParallel(['a']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(0);
    });

    test('does nothing when unsetting empty keys', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().unsetParallel([]);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
    });

    test('does nothing when unsetting whitespace-only keys', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().unsetParallel(['', '  ']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
    });

    test('handles unsetting keys not in any group', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().unsetParallel(['z']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.has('a')).toBe(true);
      expect(groups[0]!.has('b')).toBe(true);
    });

    test('removes multiple keys at once', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'c', 'd']);
      useParallelViewStore.getState().unsetParallel(['a', 'b']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.size).toBe(2);
      expect(groups[0]!.has('c')).toBe(true);
      expect(groups[0]!.has('d')).toBe(true);
    });

    test('removes keys from multiple groups', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);

      useParallelViewStore.getState().unsetParallel(['a', 'c']);

      // Both groups should be removed because each has only 1 member left
      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(0);
    });

    test('deduplicates keys to unset', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'c']);
      useParallelViewStore.getState().unsetParallel(['a', 'a']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.has('a')).toBe(false);
      expect(groups[0]!.size).toBe(2);
    });
  });

  // ── areParallels ─────────────────────────────────────────────────
  describe('areParallels', () => {
    test('returns true when both keys are in the same group', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'c']);

      expect(useParallelViewStore.getState().areParallels('a', 'b')).toBe(true);
      expect(useParallelViewStore.getState().areParallels('b', 'c')).toBe(true);
      expect(useParallelViewStore.getState().areParallels('a', 'c')).toBe(true);
    });

    test('returns false when keys are in different groups', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);

      expect(useParallelViewStore.getState().areParallels('a', 'c')).toBe(false);
      expect(useParallelViewStore.getState().areParallels('b', 'd')).toBe(false);
    });

    test('returns false when no groups exist', () => {
      expect(useParallelViewStore.getState().areParallels('a', 'b')).toBe(false);
    });

    test('returns false when one key does not exist', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);

      expect(useParallelViewStore.getState().areParallels('a', 'z')).toBe(false);
    });

    test('returns false when neither key exists', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);

      expect(useParallelViewStore.getState().areParallels('x', 'y')).toBe(false);
    });
  });

  // ── getParallels ─────────────────────────────────────────────────
  describe('getParallels', () => {
    test('returns the group containing the key', () => {
      useParallelViewStore.getState().setParallel(['a', 'b', 'c']);

      const group = useParallelViewStore.getState().getParallels('a');
      expect(group).not.toBeNull();
      expect(group!.has('a')).toBe(true);
      expect(group!.has('b')).toBe(true);
      expect(group!.has('c')).toBe(true);
    });

    test('returns null when key is not in any group', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);

      expect(useParallelViewStore.getState().getParallels('z')).toBeNull();
    });

    test('returns null when no groups exist', () => {
      expect(useParallelViewStore.getState().getParallels('a')).toBeNull();
    });

    test('returns correct group when multiple groups exist', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);

      const groupA = useParallelViewStore.getState().getParallels('a');
      expect(groupA).not.toBeNull();
      expect(groupA!.has('a')).toBe(true);
      expect(groupA!.has('b')).toBe(true);
      expect(groupA!.has('c')).toBe(false);

      const groupC = useParallelViewStore.getState().getParallels('c');
      expect(groupC).not.toBeNull();
      expect(groupC!.has('c')).toBe(true);
      expect(groupC!.has('d')).toBe(true);
      expect(groupC!.has('a')).toBe(false);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────
  describe('edge cases', () => {
    test('set and unset all returns to empty state', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().unsetParallel(['a', 'b']);

      expect(useParallelViewStore.getState().parallelViews).toHaveLength(0);
      expect(useParallelViewStore.getState().areParallels('a', 'b')).toBe(false);
      expect(useParallelViewStore.getState().getParallels('a')).toBeNull();
    });

    test('repeated setParallel with same keys is idempotent', () => {
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['a', 'b']);

      const groups = useParallelViewStore.getState().parallelViews;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.size).toBe(2);
    });

    test('complex sequence: create, extend, remove, verify', () => {
      // Create two groups
      useParallelViewStore.getState().setParallel(['a', 'b']);
      useParallelViewStore.getState().setParallel(['c', 'd']);
      expect(useParallelViewStore.getState().parallelViews).toHaveLength(2);

      // Extend first group
      useParallelViewStore.getState().setParallel(['b', 'e']);
      expect(useParallelViewStore.getState().parallelViews).toHaveLength(2);
      expect(useParallelViewStore.getState().areParallels('a', 'e')).toBe(true);

      // Remove from second group
      useParallelViewStore.getState().unsetParallel(['c']);
      // Group [d] has only 1 element, so it should be removed
      expect(useParallelViewStore.getState().parallelViews).toHaveLength(1);

      // Remaining group should be {a, b, e}
      const group = useParallelViewStore.getState().getParallels('a');
      expect(group).not.toBeNull();
      expect(group!.size).toBe(3);
    });
  });
});
