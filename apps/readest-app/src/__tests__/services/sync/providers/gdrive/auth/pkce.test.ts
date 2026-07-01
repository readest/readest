import { describe, expect, test } from 'vitest';
import {
  buildAuthUrl,
  computeChallenge,
  createPkcePair,
} from '@/services/sync/providers/gdrive/auth/pkce';

describe('pkce', () => {
  test('computeChallenge matches the RFC 7636 Appendix B known-answer vector', async () => {
    // RFC 7636 §B: verifier → S256 challenge. Catches the classic bug of hashing
    // raw verifier bytes instead of the ASCII octets of the verifier string.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await computeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('createPkcePair yields a base64url verifier and its derived challenge', async () => {
    const { verifier, challenge } = await createPkcePair();
    // base64url alphabet only (no +, /, or =), and within the RFC length window.
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(await computeChallenge(verifier));
  });

  test('buildAuthUrl sets the PKCE + offline-consent query parameters', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: 'com.googleusercontent.apps.cid:/oauthredirect',
        scope: 'https://www.googleapis.com/auth/drive.file',
        challenge: 'CHALLENGE',
        state: 'STATE',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe('com.googleusercontent.apps.cid:/oauthredirect');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(p.get('code_challenge')).toBe('CHALLENGE');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('STATE');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
  });
});
