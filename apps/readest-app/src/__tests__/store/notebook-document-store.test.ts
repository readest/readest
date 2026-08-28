import { beforeEach, describe, expect, it } from 'vitest';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';

describe('notebookDocumentStore', () => {
  beforeEach(() => useNotebookDocumentStore.getState().reset());

  it('tracks recovery availability and can discard a blocked draft', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'saved', 100);
    store.mutate('book', 'draft');
    store.markRecoveryAvailable('book', false);

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'draft',
      recoveryAvailable: false,
      status: 'dirty',
    });

    useNotebookDocumentStore.getState().discardDraft('book');
    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'saved',
      revision: 0,
      savedRevision: 0,
      status: 'clean',
    });
  });

  it('hydrates separate sessions by book hash', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book-a', 'alpha', 100);
    store.hydrate('book-b', 'beta', 200);

    expect(useNotebookDocumentStore.getState().sessions['book-a']?.content).toBe('alpha');
    expect(useNotebookDocumentStore.getState().sessions['book-b']?.content).toBe('beta');
  });

  it('does not overwrite a dirty session when hydrate is called again', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'saved', 100);
    store.mutate('book', 'draft');
    store.hydrate('book', 'remote', 200);

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'draft',
      durableContent: 'saved',
      status: 'dirty',
    });
  });

  it('increments revisions only for accepted content changes', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', '', null);

    expect(store.mutate('book', 'draft')).toEqual({ accepted: true, revision: 1 });
    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'draft',
      revision: 1,
      status: 'dirty',
      hasEdited: true,
    });
    expect(useNotebookDocumentStore.getState().mutate('book', 'draft')).toEqual({
      accepted: true,
      revision: 1,
    });
  });

  it('rejects an oversize mutation without changing the session', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'saved', 100);

    expect(store.mutate('book', 'a'.repeat(262_145))).toEqual({
      accepted: false,
      revision: 0,
    });
    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'saved',
      revision: 0,
      error: 'size-limit',
    });
  });

  it('inserts Markdown at the stored selection through the same mutation guard', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'alpha beta', 100);
    store.setSelection('book', 6, 10);

    expect(store.insert('book', '> quote')).toEqual({
      accepted: true,
      insertedStart: 8,
      insertedEnd: 15,
    });
    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'alpha \n\n> quote',
      selectionStart: 8,
      selectionEnd: 15,
      revision: 1,
    });
  });

  it('keeps a dirty local draft when a remote winner arrives', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'saved', 100);
    store.mutate('book', 'local');
    store.applyRemote('book', 'remote', 200);

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'local',
      durableContent: 'remote',
      durableUpdatedAt: 200,
      status: 'dirty',
    });
  });

  it('applies a remote winner immediately when the editor is clean', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'saved', 100);
    store.applyRemote('book', 'remote', 200);

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'remote',
      durableContent: 'remote',
      durableUpdatedAt: 200,
      status: 'clean',
    });
  });

  it('does not clear a newer revision when an older save finishes', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', '', null);
    store.mutate('book', 'first');
    store.markSaving('book', 1);
    store.mutate('book', 'second');
    store.markSaved('book', 1, 'first', 100);

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'second',
      durableContent: 'first',
      revision: 2,
      savedRevision: 1,
      status: 'dirty',
    });
  });

  it('offers and resolves a divergent recovery draft', () => {
    const store = useNotebookDocumentStore.getState();
    store.hydrate('book', 'remote', 200, 'local recovery');

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'remote',
      recoveryContent: 'local recovery',
      status: 'recovery-choice',
    });

    store.chooseRecovery('book', 'recover');
    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'local recovery',
      recoveryContent: null,
      status: 'dirty',
      revision: 1,
    });
  });
});
