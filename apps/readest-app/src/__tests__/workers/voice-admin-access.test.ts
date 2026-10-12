// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyAccess } from '../../../workers/voice-admin/src/access';

const TEAM = 'https://readest.cloudflareaccess.com';
const AUD = 'aud-tag';
const NOW = 1_800_000_000;

let keys: CryptoKeyPair;
let certs: { keys: JsonWebKey[] };

const b64url = (data: string | ArrayBuffer) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const sign = async (claims: Record<string, unknown>, kid = 'k1', key = keys.privateKey) => {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(signature)}`;
};

const valid = {
  aud: [AUD],
  iss: TEAM,
  email: 'admin@example.com',
  exp: NOW + 60,
  iat: NOW - 60,
};

const check = (token: string | null, env = { teamDomain: TEAM, aud: AUD }) =>
  verifyAccess(token, env, { now: () => NOW * 1000, fetchCerts: async () => certs });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  certs = { keys: [{ ...jwk, kid: 'k1' } as JsonWebKey] };
});

describe('verifyAccess', () => {
  it('accepts a token Access signed for this application', async () => {
    expect(await check(await sign(valid))).toEqual({ email: 'admin@example.com' });
  });

  it('accepts a single audience string', async () => {
    expect(await check(await sign({ ...valid, aud: AUD }))).toEqual({ email: 'admin@example.com' });
  });

  it('refuses a missing, malformed or tampered token', async () => {
    expect(await check(null)).toBeNull();
    expect(await check('not.a-jwt')).toBeNull();
    const token = await sign(valid);
    const [head, , sig] = token.split('.');
    const forged = b64url(JSON.stringify({ ...valid, email: 'mallory@example.com' }));
    expect(await check(`${head}.${forged}.${sig}`)).toBeNull();
  });

  it('refuses tokens for another application, team, or past their expiry', async () => {
    expect(await check(await sign({ ...valid, aud: ['other'] }))).toBeNull();
    expect(
      await check(await sign({ ...valid, iss: 'https://evil.cloudflareaccess.com' })),
    ).toBeNull();
    expect(await check(await sign({ ...valid, exp: NOW - 1 }))).toBeNull();
    expect(await check(await sign({ ...valid, nbf: NOW + 60 }))).toBeNull();
  });

  it('refuses a key it does not know', async () => {
    expect(await check(await sign(valid, 'k2'))).toBeNull();
  });

  it('refuses everything until Access is configured', async () => {
    const token = await sign(valid);
    expect(await check(token, { teamDomain: '', aud: AUD })).toBeNull();
    expect(await check(token, { teamDomain: TEAM, aud: '' })).toBeNull();
  });
});
