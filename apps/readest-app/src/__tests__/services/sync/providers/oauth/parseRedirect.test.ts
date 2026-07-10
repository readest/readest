import { describe, expect, test } from 'vitest';
import { parseRedirect } from '@/services/sync/providers/oauth/parseRedirect';

const REDIRECT_URI = 'com.googleusercontent.apps.cid:/oauthredirect';

describe('parseRedirect', () => {
  test('returns the code when target, state and code are all valid', () => {
    const url = `${REDIRECT_URI}?code=AUTH_CODE&state=STATE`;
    expect(parseRedirect(url, 'STATE', REDIRECT_URI)).toEqual({ code: 'AUTH_CODE' });
  });

  test('rejects a URL aimed at a different scheme/path (target guard)', () => {
    const url = 'readest://auth-callback?code=AUTH_CODE&state=STATE';
    expect(() => parseRedirect(url, 'STATE', REDIRECT_URI)).toThrow(/target mismatch/i);
  });

  test('rejects a right-scheme but wrong-path redirect', () => {
    const url = 'com.googleusercontent.apps.cid:/somethingelse?code=AUTH_CODE&state=STATE';
    expect(() => parseRedirect(url, 'STATE', REDIRECT_URI)).toThrow(/target mismatch/i);
  });

  test('surfaces a provider error param ahead of the CSRF/code checks', () => {
    const url = `${REDIRECT_URI}?error=access_denied&state=WRONG`;
    expect(() => parseRedirect(url, 'STATE', REDIRECT_URI)).toThrow(/access_denied/);
  });

  test('rejects a state mismatch (CSRF guard)', () => {
    const url = `${REDIRECT_URI}?code=AUTH_CODE&state=WRONG`;
    expect(() => parseRedirect(url, 'STATE', REDIRECT_URI)).toThrow(/state mismatch/i);
  });

  test('rejects a redirect with no code', () => {
    const url = `${REDIRECT_URI}?state=STATE`;
    expect(() => parseRedirect(url, 'STATE', REDIRECT_URI)).toThrow(
      /missing the authorization code/i,
    );
  });
});
