import { describe, expect, test, vi } from 'vitest';
import { runOAuthFlow, type OAuthFlowDeps } from '@/services/sync/providers/gdrive/auth/oauthFlow';

const REDIRECT_URI = 'com.googleusercontent.apps.cid:/oauthredirect';

const makeDeps = (overrides: Partial<OAuthFlowDeps>, order: string[]): OAuthFlowDeps => ({
  createPkcePair: async () => ({ verifier: 'VER', challenge: 'CHAL' }),
  newState: () => 'STATE',
  clientId: 'cid',
  redirectUri: REDIRECT_URI,
  openUrl: async () => {
    order.push('open');
  },
  awaitRedirect: async () => {
    order.push('await');
    return `${REDIRECT_URI}?code=CODE&state=STATE`;
  },
  exchange: async () => ({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 }),
  ...overrides,
});

describe('runOAuthFlow', () => {
  test('arms the redirect capture before opening, then exchanges the code', async () => {
    const order: string[] = [];
    let openedUrl = '';
    const exchange = vi.fn(async () => ({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 }));
    const deps = makeDeps(
      {
        openUrl: async (url) => {
          order.push('open');
          openedUrl = url;
        },
        exchange,
      },
      order,
    );

    const tokens = await runOAuthFlow('drive.file', deps);

    // The capture must be armed before the consent URL is opened (redirect race).
    expect(order).toEqual(['await', 'open']);
    expect(openedUrl).toContain('code_challenge=CHAL');
    expect(openedUrl).toContain('state=STATE');
    expect(exchange).toHaveBeenCalledWith({
      code: 'CODE',
      verifier: 'VER',
      redirectUri: REDIRECT_URI,
    });
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 });
  });

  test('propagates a CSRF state mismatch from the redirect', async () => {
    const order: string[] = [];
    const deps = makeDeps(
      { awaitRedirect: async () => `${REDIRECT_URI}?code=CODE&state=ATTACKER` },
      order,
    );
    await expect(runOAuthFlow('drive.file', deps)).rejects.toThrow(/state mismatch/i);
  });
});
