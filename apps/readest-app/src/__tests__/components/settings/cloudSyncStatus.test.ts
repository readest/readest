import { describe, expect, test } from 'vitest';
import {
  canToggleCloudProvider,
  getReadestCloudRowStatus,
  getThirdPartyRowStatus,
  shouldShowCloudProviderBadge,
} from '@/components/settings/integrations/cloudSyncStatus';

const _ = (key: string) => key;

describe('getReadestCloudRowStatus', () => {
  test('signed out wins over everything', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: false, planLoading: true, enabled: true })).toBe(
      'Not signed in',
    );
  });

  test('loading while the plan resolves', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: true, planLoading: true, enabled: true })).toBe(
      '…',
    );
  });

  test('reports off when the user unchecked it', () => {
    expect(
      getReadestCloudRowStatus(_, { signedIn: true, planLoading: false, enabled: false }),
    ).toBe('Off');
  });

  test('reports active when checked', () => {
    expect(getReadestCloudRowStatus(_, { signedIn: true, planLoading: false, enabled: true })).toBe(
      'Active',
    );
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
    booksBackedUpElsewhere: false,
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

  test('needs reauth when the web token is gone (outranks syncing/active, not paused)', () => {
    expect(getThirdPartyRowStatus(_, { ...base, needsReauth: true })).toBe('Reconnect required');
    // A gone token must never read as active or as an in-flight sync.
    expect(getThirdPartyRowStatus(_, { ...base, needsReauth: true, syncing: true })).toBe(
      'Reconnect required',
    );
    // But a plan-level pause still outranks it.
    expect(getThirdPartyRowStatus(_, { ...base, needsReauth: true, paused: true })).toBe(
      'Paused — plan required',
    );
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
    expect(getThirdPartyRowStatus(_, base)).toBe('Active');
  });
});

describe('getThirdPartyRowStatus: book file coverage', () => {
  const base = {
    enabled: true,
    configured: true,
    syncing: false,
    paused: false,
    lastError: null,
    syncBooks: false,
  };

  test('warns only when nothing else backs up the book files', () => {
    expect(getThirdPartyRowStatus(_, { ...base, booksBackedUpElsewhere: false })).toBe(
      'Active · Book file uploads off',
    );
  });

  test('stays plain Active when another provider holds the book files', () => {
    expect(getThirdPartyRowStatus(_, { ...base, booksBackedUpElsewhere: true })).toBe('Active');
  });
});

describe('canToggleCloudProvider', () => {
  test('premium and configured can be toggled', () => {
    expect(canToggleCloudProvider({ isPremium: true, isConfigured: true, isEnabled: false })).toBe(
      true,
    );
  });

  test('premium, unconfigured, and not enabled cannot be toggled', () => {
    expect(canToggleCloudProvider({ isPremium: true, isConfigured: false, isEnabled: false })).toBe(
      false,
    );
  });

  test('a lapsed-plan user can always switch an enabled provider off', () => {
    expect(canToggleCloudProvider({ isPremium: false, isConfigured: false, isEnabled: true })).toBe(
      true,
    );
  });

  test('not premium and not enabled cannot be toggled', () => {
    expect(
      canToggleCloudProvider({ isPremium: false, isConfigured: false, isEnabled: false }),
    ).toBe(false);
  });

  test('premium with cleared config but still enabled can be toggled (rescue)', () => {
    expect(canToggleCloudProvider({ isPremium: true, isConfigured: false, isEnabled: true })).toBe(
      true,
    );
  });
});

describe('shouldShowCloudProviderBadge', () => {
  test('signed out on a hosted deployment sees the tier chip and stays gated', () => {
    // The chip and the gate have to move together: a signed-out visitor to a
    // hosted deployment is not entitled, so the row is badged AND unusable.
    expect(
      shouldShowCloudProviderBadge({ signedIn: false, planLoading: false, isPremium: false }),
    ).toBe(true);
    expect(canToggleCloudProvider({ isPremium: false, isConfigured: true, isEnabled: false })).toBe(
      false,
    );
  });

  test('signed out on a self-hosted deployment does not (#6093)', () => {
    // Self-hosting unlocks cloud sync with or without a signed-in user, so the
    // chip would label a feature the operator already has as premium.
    expect(
      shouldShowCloudProviderBadge({ signedIn: false, planLoading: false, isPremium: true }),
    ).toBe(false);
  });

  test('stays hidden while a signed-in user plan is still resolving', () => {
    expect(
      shouldShowCloudProviderBadge({ signedIn: true, planLoading: true, isPremium: false }),
    ).toBe(false);
  });

  test('a resolved free plan sees the tier chip', () => {
    expect(
      shouldShowCloudProviderBadge({ signedIn: true, planLoading: false, isPremium: false }),
    ).toBe(true);
  });

  test('an entitled user never sees it', () => {
    expect(
      shouldShowCloudProviderBadge({ signedIn: true, planLoading: false, isPremium: true }),
    ).toBe(false);
  });
});
