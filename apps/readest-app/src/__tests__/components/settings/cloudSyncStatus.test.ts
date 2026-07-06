import { describe, expect, test } from 'vitest';
import {
  getReadestCloudRowStatus,
  getThirdPartyRowStatus,
} from '@/components/settings/integrations/cloudSyncStatus';

const _ = (key: string) => key;

describe('getReadestCloudRowStatus', () => {
  test('signed out wins over everything', () => {
    expect(
      getReadestCloudRowStatus(_, { signedIn: false, planLoading: true, selected: true }),
    ).toBe('Not signed in');
  });

  test('loading while the plan resolves', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: true, planLoading: true, selected: true })).toBe(
      '…',
    );
  });

  test('active when signed in and selected', () => {
    expect(
      getReadestCloudRowStatus(_, { signedIn: true, planLoading: false, selected: true }),
    ).toBe('Active — syncing your library on this device');
  });

  test('available when a third-party provider is selected instead', () => {
    expect(
      getReadestCloudRowStatus(_, { signedIn: true, planLoading: false, selected: false }),
    ).toBe('Available');
  });
});

describe('getThirdPartyRowStatus', () => {
  const base = {
    enabled: true,
    configured: true,
    syncing: false,
    paused: false,
    lastError: null,
    syncBooks: true,
  };

  test('not connected / configured when inactive', () => {
    expect(getThirdPartyRowStatus(_, { ...base, enabled: false, configured: false })).toBe(
      'Not connected',
    );
    expect(getThirdPartyRowStatus(_, { ...base, enabled: false })).toBe('Configured');
  });

  test('paused outranks syncing, errors, and warnings', () => {
    expect(
      getThirdPartyRowStatus(_, { ...base, paused: true, syncing: true, lastError: 'x' }),
    ).toBe('Paused — plan required');
  });

  test('syncing while a run is in flight', () => {
    expect(getThirdPartyRowStatus(_, { ...base, syncing: true })).toBe('Syncing…');
  });

  test('sync failed after a terminal error', () => {
    expect(getThirdPartyRowStatus(_, { ...base, lastError: 'AUTH_FAILED' })).toBe('Sync failed');
  });

  test('warns when book file uploads are off (books back up nowhere)', () => {
    expect(getThirdPartyRowStatus(_, { ...base, syncBooks: false })).toBe(
      'Active · Book file uploads off',
    );
  });

  test('healthy active state', () => {
    expect(getThirdPartyRowStatus(_, base)).toBe('Active — syncing your library on this device');
  });
});
