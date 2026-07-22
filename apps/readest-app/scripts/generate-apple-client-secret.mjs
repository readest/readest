// Generate the "Sign in with Apple" client secret JWT for the Supabase Apple
// OAuth provider. Apple caps this secret's lifetime at 6 months, so the web
// OAuth flow (macOS non-store .dmg + Linux) breaks with
//   "server_error ... Unable to exchange external code"
// whenever it expires. Regenerate here and paste the output into
//   Supabase -> Authentication -> Providers -> Apple -> Secret Key (for OAuth)
//
// The native flow (iOS + macOS App Store, signInWithIdToken) does NOT use this
// secret, which is why those keep working while the web flow fails.
//
// Usage (flags override env; env vars mirror the CI naming):
//   node scripts/generate-apple-client-secret.mjs \
//     --team-id J5W48D69VR \
//     --client-id com.bilingify.readest.signin \  # the Services ID, NOT the app bundle id
//     --key-id ABCDE12345 \
//     --key-path ../private_keys/AuthKey_ABCDE12345.p8 \
//     [--days 180]
//
// Env fallbacks: APPLE_TEAM_ID, APPLE_CLIENT_ID (or APPLE_SERVICES_ID),
//                APPLE_KEY_ID, APPLE_KEY_PATH, APPLE_SECRET_DAYS
//
// The signed JWT is printed to stdout (pipe-friendly); everything else to stderr.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';

const AUD = 'https://appleid.apple.com';
const MAX_DAYS = 180; // Apple rejects secrets with exp more than ~6 months out

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
      args[arg.slice(2)] = true; // boolean flag, e.g. --help
    } else {
      args[arg.slice(2)] = argv[++i];
    }
  }
  return args;
};

const die = (msg) => {
  console.error(`Error: ${msg}`);
  console.error('Run with --help for usage.');
  process.exit(1);
};

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.error(readFileSync(new URL(import.meta.url)).toString().split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

const teamId = args['team-id'] ?? process.env.APPLE_TEAM_ID;
const clientId =
  args['client-id'] ?? process.env.APPLE_CLIENT_ID ?? process.env.APPLE_SERVICES_ID;
const keyId = args['key-id'] ?? process.env.APPLE_KEY_ID;
const keyPath = args['key-path'] ?? process.env.APPLE_KEY_PATH;
const days = Number(args.days ?? process.env.APPLE_SECRET_DAYS ?? MAX_DAYS);

if (!teamId) die('missing --team-id (Apple Developer Team ID)');
if (!clientId) die('missing --client-id (the Services ID / OAuth Client ID)');
if (!keyId) die('missing --key-id (the "Sign in with Apple" key ID)');
if (!keyPath) die('missing --key-path (path to the AuthKey_*.p8 file)');
if (!Number.isFinite(days) || days <= 0) die(`invalid --days: ${args.days}`);
if (days > MAX_DAYS) die(`--days ${days} exceeds Apple's ${MAX_DAYS}-day maximum`);

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(resolve(keyPath)));
} catch (err) {
  die(`could not read private key at ${keyPath}: ${err.message}`);
}

const base64url = (input) =>
  Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)).toString('base64url');

const now = Math.floor(Date.now() / 1000);
const exp = now + days * 24 * 60 * 60;

const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
const payload = { iss: teamId, iat: now, exp, aud: AUD, sub: clientId };

const signingInput = `${base64url(header)}.${base64url(payload)}`;
// dsaEncoding 'ieee-p1363' emits the raw R||S signature JOSE/JWT requires (not DER).
const signature = sign('sha256', Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
}).toString('base64url');

const jwt = `${signingInput}.${signature}`;

console.error(`Generated Apple client secret for Services ID "${clientId}"`);
console.error(`  Team ID: ${teamId}  Key ID: ${keyId}`);
console.error(`  Expires: ${new Date(exp * 1000).toISOString()} (${days} days)`);
console.error('Paste the JWT below into Supabase -> Auth -> Providers -> Apple -> Secret Key:\n');
console.log(jwt);
