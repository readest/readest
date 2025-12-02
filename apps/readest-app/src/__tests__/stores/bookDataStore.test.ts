import { describe, it, expect, beforeEach } from 'vitest';
import { useBookDataStore } from '../../store/bookDataStore';
import { Replacement } from '@/types/book';

// Factory for valid Replacement objects
function makeReplacement(
  id: string,
  extra: Partial<Replacement> = {}
): Replacement {
  return {
    id,
    original: 'old',
    replacement: 'new',
    scope: 'single',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deviceId: '',
    ...extra,
  };
}

// Reset store before each test
beforeEach(() => {
  useBookDataStore.setState({
    booksData: {
      abc: {
        id: 'abc',
        book: null,
        file: null,
        bookDoc: null,
        isFixedLayout: false,
        config: {
          updatedAt: 0,
          viewSettings: {
            replacements: [],
          },
        },
      },
    },
  });
});

describe('updateReplacements', () => {
  it('deduplicates replacements and updates the config correctly', () => {
    const store = useBookDataStore.getState();

    const replacements = [
      makeReplacement('1'),
      makeReplacement('1'), // duplicate
      makeReplacement('2'),
    ];

    const updated = store.updateReplacements('abc-123', replacements);

    // Must return a config
    expect(updated).toBeDefined();

    // Deduped to two
    expect(updated!.viewSettings!.replacements!.length).toBe(2);

    // updatedAt should have changed
    expect(updated!.updatedAt).toBeGreaterThan(0);

    // Store state must match
    const finalState = useBookDataStore.getState();
    const cfg = finalState.booksData['abc']!.config!;
    expect(cfg.viewSettings!.replacements!.length).toBe(2); 
  });

  it('returns undefined if the book does not exist', () => {
    const store = useBookDataStore.getState();
    const result = store.updateReplacements('missing-book', []);
    expect(result).toBeUndefined();
  });
});
