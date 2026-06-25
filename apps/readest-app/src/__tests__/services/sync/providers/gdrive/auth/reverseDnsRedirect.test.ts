import { describe, expect, test } from 'vitest';
import {
  deriveReverseDnsRedirectScheme,
  deriveReverseDnsRedirectUri,
  matchesReverseDnsRedirect,
} from '@/services/sync/providers/gdrive/auth/reverseDnsRedirect';

const CLIENT_ID = '123456789-AbCdEf.apps.googleusercontent.com';

describe('reverseDnsRedirect', () => {
  test('derives the scheme by stripping the googleusercontent suffix and lowercasing', () => {
    expect(deriveReverseDnsRedirectScheme(CLIENT_ID)).toBe(
      'com.googleusercontent.apps.123456789-abcdef',
    );
  });

  test('derives the full redirect URI with a single-slash path', () => {
    expect(deriveReverseDnsRedirectUri(CLIENT_ID)).toBe(
      'com.googleusercontent.apps.123456789-abcdef:/oauthredirect',
    );
  });

  test('tolerates a client id that is already just the identifier part', () => {
    expect(deriveReverseDnsRedirectScheme('rawid')).toBe('com.googleusercontent.apps.rawid');
  });

  test('matches a redirect URL case-insensitively, scheme-anchored', () => {
    const scheme = deriveReverseDnsRedirectScheme(CLIENT_ID);
    expect(matchesReverseDnsRedirect(`${scheme}:/oauthredirect?code=x&state=y`, scheme)).toBe(true);
    // Windows may relaunch with a differently-cased scheme in argv.
    expect(matchesReverseDnsRedirect(`${scheme.toUpperCase()}:/oauthredirect`, scheme)).toBe(true);
  });

  test('does not match a different scheme or a prefix scheme', () => {
    const scheme = deriveReverseDnsRedirectScheme(CLIENT_ID);
    expect(matchesReverseDnsRedirect('readest://auth-callback', scheme)).toBe(false);
    // A scheme that is a strict prefix of a longer one must not false-match.
    expect(matchesReverseDnsRedirect(`${scheme}extra:/x`, scheme)).toBe(false);
  });
});
