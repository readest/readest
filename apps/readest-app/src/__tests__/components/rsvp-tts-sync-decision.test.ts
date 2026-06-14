import { describe, test, expect } from 'vitest';
import {
  decideRsvpTtsPosition,
  type RsvpTtsSyncState,
  type RsvpTtsPositionDetail,
} from '@/app/reader/components/rsvp/RSVPControl';

const BOOK_KEY = 'hash123-session456';

const freshState = (over: Partial<RsvpTtsSyncState> = {}): RsvpTtsSyncState => ({
  following: true,
  lastSequenceSeen: -Infinity,
  currentSectionIndex: 2,
  ...over,
});

const detail = (over: Partial<RsvpTtsPositionDetail> = {}): RsvpTtsPositionDetail => ({
  bookKey: BOOK_KEY,
  cfi: 'epubcfi(/6/6!/4/2/1:0)',
  kind: 'word',
  sectionIndex: 2,
  sequence: 1,
  ...over,
});

describe('decideRsvpTtsPosition (slice 5, #3235)', () => {
  test('word + following + same section → sync (Edge word-level), advances lastSequenceSeen', () => {
    const result = decideRsvpTtsPosition(
      freshState(),
      detail({ kind: 'word', sequence: 5 }),
      BOOK_KEY,
    );
    expect(result.action).toBe('sync');
    expect(result.cfi).toBe('epubcfi(/6/6!/4/2/1:0)');
    expect(result.nextState.lastSequenceSeen).toBe(5);
  });

  test('sentence + following + same section → drive-estimator (non-Edge)', () => {
    const result = decideRsvpTtsPosition(
      freshState(),
      detail({ kind: 'sentence', sequence: 3 }),
      BOOK_KEY,
    );
    expect(result.action).toBe('drive-estimator');
    expect(result.cfi).toBe('epubcfi(/6/6!/4/2/1:0)');
    expect(result.nextState.lastSequenceSeen).toBe(3);
  });

  test('drops events for a different bookKey (no state change)', () => {
    const state = freshState({ lastSequenceSeen: 1 });
    const result = decideRsvpTtsPosition(state, detail({ bookKey: 'other-book' }), BOOK_KEY);
    expect(result.action).toBe('ignore');
    expect(result.nextState).toBe(state);
  });

  test('drops stale / out-of-order sequence (<= lastSequenceSeen)', () => {
    const state = freshState({ lastSequenceSeen: 10 });
    const result = decideRsvpTtsPosition(state, detail({ sequence: 10 }), BOOK_KEY);
    expect(result.action).toBe('ignore');
    expect(result.nextState).toBe(state);

    const older = decideRsvpTtsPosition(state, detail({ sequence: 4 }), BOOK_KEY);
    expect(older.action).toBe('ignore');
  });

  test('does nothing while decoupled (following=false) and does NOT advance the sequence', () => {
    const state = freshState({ following: false, lastSequenceSeen: 2 });
    const result = decideRsvpTtsPosition(state, detail({ sequence: 7 }), BOOK_KEY);
    expect(result.action).toBe('ignore');
    // Sequence not bumped: when we re-engage we want the next live position.
    expect(result.nextState.lastSequenceSeen).toBe(2);
  });

  test('different section → re-extract + stash latest (no mapping)', () => {
    const result = decideRsvpTtsPosition(
      freshState({ currentSectionIndex: 2 }),
      detail({ sectionIndex: 5, sequence: 9, cfi: 'epubcfi(/6/12!/4/2/1:0)' }),
      BOOK_KEY,
    );
    expect(result.action).toBe('reextract');
    expect(result.nextState.lastSequenceSeen).toBe(9);
    expect(result.nextState.pendingSync).toEqual({
      cfi: 'epubcfi(/6/12!/4/2/1:0)',
      sequence: 9,
      sectionIndex: 5,
    });
  });

  test('guards malformed details (missing cfi / sectionIndex) → ignore', () => {
    const state = freshState();
    expect(decideRsvpTtsPosition(state, detail({ cfi: undefined }), BOOK_KEY).action).toBe(
      'ignore',
    );
    expect(decideRsvpTtsPosition(state, detail({ sectionIndex: undefined }), BOOK_KEY).action).toBe(
      'ignore',
    );
  });
});
