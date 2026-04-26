import { BookConfig } from '@/types/book';
import { RsvpPosition } from './types';

// Builds the BookConfig delta to persist when leaving RSVP. Pinning `location`
// to the RSVP word's CFI is what stops the next normal-mode load from resuming
// at the boundary CFI a mid-RSVP section transition wrote into the config.
export const buildRsvpExitConfigUpdate = (rsvpPosition: RsvpPosition): Partial<BookConfig> => {
  if (rsvpPosition.cfi) {
    return { rsvpPosition, location: rsvpPosition.cfi };
  }
  return { rsvpPosition };
};
