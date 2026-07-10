import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectViewTransitionGroup, detectViewTransitionsAPI } from '@/utils/viewTransition';

// The DOM lib types startViewTransition as always present; go through a loose
// shape so the stub can also remove it.
type VTDocument = { startViewTransition?: () => void };

const stubEngine = ({
  startViewTransition,
  nestedGroups,
}: {
  startViewTransition: boolean;
  nestedGroups: boolean;
}) => {
  const doc = document as unknown as VTDocument;
  if (startViewTransition) doc.startViewTransition = () => {};
  else delete doc.startViewTransition;
  vi.stubGlobal('CSS', {
    supports: (property: string, value: string) =>
      nestedGroups && property === 'view-transition-group' && value === 'nearest',
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as unknown as VTDocument).startViewTransition;
});

describe('detectViewTransitionsAPI', () => {
  it('is true on any engine with document.startViewTransition, even without nested groups', () => {
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(detectViewTransitionsAPI()).toBe(true);
  });

  it('is false without the View Transitions API', () => {
    stubEngine({ startViewTransition: false, nestedGroups: true });
    expect(detectViewTransitionsAPI()).toBe(false);
  });
});

describe('detectViewTransitionGroup', () => {
  it('requires nested view-transition groups on top of the API', () => {
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(detectViewTransitionGroup()).toBe(false);
  });

  it('is true only when the API and nested groups are both present', () => {
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(detectViewTransitionGroup()).toBe(true);
  });

  it('is false without the API even if the group query matches', () => {
    stubEngine({ startViewTransition: false, nestedGroups: true });
    expect(detectViewTransitionGroup()).toBe(false);
  });
});
