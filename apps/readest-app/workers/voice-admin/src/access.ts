// Cloudflare Access puts a signed JWT on every request it lets through
// (Cf-Access-Jwt-Assertion). The Worker checks it again, so a request that
// reaches it any other way, or before Access is configured, gets nothing.

export interface AccessConfig {
  // https://<team>.cloudflareaccess.com
  teamDomain: string;
  // The Access application's audience (AUD) tag.
  aud: string;
}

interface Certs {
  keys: (JsonWebKey & { kid?: string })[];
}

interface Deps {
  now?: () => number;
  fetchCerts?: (url: string) => Promise<Certs>;
}

interface Claims {
  aud?: string | string[];
  iss?: string;
  email?: string;
  exp?: number;
  nbf?: number;
}

const CERTS_TTL_MS = 10 * 60_000;
let cached: { url: string; certs: Certs; at: number } | null = null;

const fetchCerts = async (url: string): Promise<Certs> => {
  if (cached?.url === url && Date.now() - cached.at < CERTS_TTL_MS) return cached.certs;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const certs = (await res.json()) as Certs;
  cached = { url, certs, at: Date.now() };
  return certs;
};

const decode = (part: string): Uint8Array<ArrayBuffer> => {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

const json = <T>(part: string): T => JSON.parse(new TextDecoder().decode(decode(part))) as T;

// The signed-in admin, or null for anything not issued by this team's
// Access for this application.
export const verifyAccess = async (
  token: string | null,
  config: AccessConfig,
  deps: Deps = {},
): Promise<{ email: string } | null> => {
  const { teamDomain, aud } = config;
  if (!token || !teamDomain || !aud) return null;
  try {
    const [head, body, signature] = token.split('.');
    if (!head || !body || !signature) return null;
    const header = json<{ alg?: string; kid?: string }>(head);
    if (header.alg !== 'RS256') return null;
    const certs = await (deps.fetchCerts ?? fetchCerts)(`${teamDomain}/cdn-cgi/access/certs`);
    const jwk = certs.keys.find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decode(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!signed) return null;
    const claims = json<Claims>(body);
    const now = (deps.now ?? Date.now)() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(aud) || claims.iss !== teamDomain) return null;
    if (!claims.exp || claims.exp <= now || (claims.nbf && claims.nbf > now)) return null;
    return { email: claims.email ?? '' };
  } catch {
    return null;
  }
};
