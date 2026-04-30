import { describe, expect, test } from 'vitest';
import { buildRsvpExitConfigUpdate } from '@/services/rsvp/persistence';

describe('buildRsvpExitConfigUpdate', () => {
  test('pins location to the RSVP word CFI when present', () => {
    const rsvpPosition = {
      cfi: 'epubcfi(/6/8!/4/2/1:42)',
      wordText: 'somewhere',
    };

    const update = buildRsvpExitConfigUpdate(rsvpPosition);

    expect(update.rsvpPosition).toEqual(rsvpPosition);
    expect(update.location).toBe('epubcfi(/6/8!/4/2/1:42)');
  });

  test('omits location when the RSVP word has no CFI', () => {
    const rsvpPosition = { cfi: '', wordText: 'no-cfi' };

    const update = buildRsvpExitConfigUpdate(rsvpPosition);

    expect(update.rsvpPosition).toEqual(rsvpPosition);
    expect('location' in update).toBe(false);
  });
});
