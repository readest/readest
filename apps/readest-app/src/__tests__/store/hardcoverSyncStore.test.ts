import { beforeEach, describe, expect, it } from 'vitest';
import { useHardcoverSyncStore } from '@/store/hardcoverSyncStore';

const { begin, end } = useHardcoverSyncStore.getState();
const book = (bookKey: string) => useHardcoverSyncStore.getState().byBook[bookKey];

beforeEach(() => useHardcoverSyncStore.setState({ byBook: {} }));

describe('hardcoverSyncStore', () => {
  it('keeps a failure until every overlapping push finishes, whatever order they end in', () => {
    begin('a');
    begin('a');
    end('a', 'boom');
    end('a', null);

    expect(book('a')).toEqual({ pending: 0, lastError: 'boom' });
  });

  it('clears the previous error when a new batch starts', () => {
    begin('a');
    end('a', 'boom');
    begin('a');

    expect(book('a')).toEqual({ pending: 1, lastError: null });
    end('a', null);
    expect(book('a')).toEqual({ pending: 0, lastError: null });
  });

  it("keeps one book's failure off every other book", () => {
    begin('a');
    end('a', 'boom');
    begin('b');

    expect(book('a')).toEqual({ pending: 0, lastError: 'boom' });
    expect(book('b')).toEqual({ pending: 1, lastError: null });
  });
});
