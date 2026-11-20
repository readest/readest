// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: invokeSpy,
}));

import {
  AnkiError,
  ankiAddNotes,
  ankiReadDeck,
  ankiStatus,
  ankiUpdateTags,
} from '@/services/vocabulary/ankiDroid';

beforeEach(() => {
  invokeSpy.mockReset();
});

describe('ankiDroid', () => {
  it('reads a deck by id through the native bridge', async () => {
    invokeSpy.mockResolvedValue({ notes: [{ id: 1, fields: ['a'], tags: '' }] });
    const deck = await ankiReadDeck([5, 6], true);
    expect(invokeSpy).toHaveBeenCalledWith('plugin:native-bridge|anki_read_deck', {
      payload: { deckIds: [5, 6], withCards: true },
    });
    expect(deck).toEqual({ notes: [{ id: 1, fields: ['a'], tags: '' }], cards: undefined });
  });

  it('turns an error field into an AnkiError with its code', async () => {
    invokeSpy.mockResolvedValue({ error: 'not_ready' });
    const err = await ankiReadDeck([5], true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnkiError);
    expect((err as AnkiError).code).toBe('not_ready');
  });

  it('sends notes to each of their decks and returns how many were added', async () => {
    invokeSpy.mockResolvedValue({ added: 1 });
    const note = (deck: string, word: string) => ({
      deck,
      fields: [word, 'b'] as [string, string],
      tags: ['readest'],
    });
    const notes = [note('R::French', 'pain'), note('R::Spanish', 'hola'), note('R::French', 'vin')];
    await expect(ankiAddNotes(notes)).resolves.toBe(2);
    expect(invokeSpy.mock.calls).toEqual([
      [
        'plugin:native-bridge|anki_add_notes',
        {
          payload: {
            deckName: 'R::French',
            notes: [
              { fields: ['pain', 'b'], tags: ['readest'] },
              { fields: ['vin', 'b'], tags: ['readest'] },
            ],
          },
        },
      ],
      [
        'plugin:native-bridge|anki_add_notes',
        {
          payload: {
            deckName: 'R::Spanish',
            notes: [{ fields: ['hola', 'b'], tags: ['readest'] }],
          },
        },
      ],
    ]);
  });

  it('updates note tags and returns how many changed', async () => {
    invokeSpy.mockResolvedValue({ updated: 2 });
    const notes = [
      { id: 1, tags: ['readest', 'readest::mastered'] },
      { id: 2, tags: ['readest::learning'] },
    ];
    await expect(ankiUpdateTags(notes)).resolves.toBe(2);
    expect(invokeSpy).toHaveBeenCalledWith('plugin:native-bridge|anki_update_tags', {
      payload: { notes },
    });
  });

  it('reports AnkiDroid missing when the bridge is unavailable', async () => {
    invokeSpy.mockRejectedValue(new Error('Unsupported platform for this plugin'));
    await expect(ankiStatus()).resolves.toEqual({ installed: false, granted: false });
  });
});
