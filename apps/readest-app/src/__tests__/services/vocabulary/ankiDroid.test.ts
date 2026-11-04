import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: invokeSpy,
}));

import { AnkiError, ankiAddNotes, ankiReadDeck, ankiStatus } from '@/services/vocabulary/ankiDroid';

beforeEach(() => {
  invokeSpy.mockReset();
});

describe('ankiDroid', () => {
  it('reads a deck by id through the native bridge', async () => {
    invokeSpy.mockResolvedValue({ notes: [{ id: 1, fields: ['a'], tags: '' }] });
    const deck = await ankiReadDeck(5, true);
    expect(invokeSpy).toHaveBeenCalledWith('plugin:native-bridge|anki_read_deck', {
      payload: { deckId: 5, withCards: true },
    });
    expect(deck).toEqual({ notes: [{ id: 1, fields: ['a'], tags: '' }], cards: undefined });
  });

  it('turns an error field into an AnkiError with its code', async () => {
    invokeSpy.mockResolvedValue({ error: 'not_ready' });
    const err = await ankiReadDeck(5, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnkiError);
    expect((err as AnkiError).code).toBe('not_ready');
  });

  it('sends notes and returns how many were added', async () => {
    invokeSpy.mockResolvedValue({ added: 2 });
    const notes = [{ fields: ['f', 'b'] as [string, string], tags: ['readest'] }];
    await expect(ankiAddNotes('Readest Vocabulary', notes)).resolves.toBe(2);
    expect(invokeSpy).toHaveBeenCalledWith('plugin:native-bridge|anki_add_notes', {
      payload: { deckName: 'Readest Vocabulary', notes },
    });
  });

  it('reports AnkiDroid missing when the bridge is unavailable', async () => {
    invokeSpy.mockRejectedValue(new Error('Unsupported platform for this plugin'));
    await expect(ankiStatus()).resolves.toEqual({ installed: false, granted: false });
  });
});
