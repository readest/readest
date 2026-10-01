import { beforeEach, describe, expect, it } from 'vitest';
import { useHardcoverSyncStore } from '@/store/hardcoverSyncStore';

const { begin, end } = useHardcoverSyncStore.getState();
const state = () => useHardcoverSyncStore.getState();

beforeEach(() => useHardcoverSyncStore.setState({ pending: 0, lastError: null }));

describe('hardcoverSyncStore', () => {
  it('keeps a failure until every overlapping push finishes, whatever order they end in', () => {
    begin();
    begin();
    end('boom');
    end(null);

    expect(state()).toMatchObject({ pending: 0, lastError: 'boom' });
  });

  it('clears the previous error when a new batch starts', () => {
    begin();
    end('boom');
    begin();

    expect(state()).toMatchObject({ pending: 1, lastError: null });
    end(null);
    expect(state()).toMatchObject({ pending: 0, lastError: null });
  });
});
