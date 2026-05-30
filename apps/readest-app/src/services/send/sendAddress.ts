// Crockford base32 — omits I, L, O, U to avoid look-alike confusion. Lowercased
// here because the value is the local part of an email address.
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
// 5 chars ≈ 25 bits. Following Send to Kindle's model: the suffix is for
// address uniqueness, not secrecy — the approved-sender allowlist is the
// security gate. It also keeps `{slug}-{token}` from ever colliding with a
// plain role address like `info@` / `admin@`.
const TOKEN_LENGTH = 5;
const SLUG_MAX = 12;

// Role / system addresses a user-chosen slug must not impersonate. The token
// suffix already prevents an exact routing collision; this is for clarity so
// nobody gets an address that reads as official.
const RESERVED_SLUGS = new Set([
  'admin',
  'info',
  'support',
  'legal',
  'privacy',
  'mailrobot',
  'help',
  'contact',
  'abuse',
  'postmaster',
  'noreply',
  'sales',
  'readest',
  'root',
  'webmaster',
  'security',
  'billing',
]);

/** Derive a short, sanitized slug from a display name or email local part. */
export function slugFromIdentity(identity: string): string {
  const localPart = identity.includes('@') ? identity.split('@')[0]! : identity;
  return sanitizeSlug(localPart) || 'reader';
}

/** Normalize a user-supplied slug to the allowed shape (`[a-z0-9]`, ≤12). */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, SLUG_MAX);
}

/** Whether a slug impersonates a role/system address. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Generate the random, high-entropy half of an inbound address. */
export function generateAddressToken(
  randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH)),
): string {
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += CROCKFORD[randomBytes[i]! % 32];
  }
  return token;
}

/**
 * Build an inbound address local part `{slug}-{token}` from an explicit slug.
 * The caller must retry on a UNIQUE-constraint collision (a fresh token).
 */
export function buildSendAddress(slug: string): string {
  return `${slug}-${generateAddressToken()}`;
}

/**
 * Build an inbound address local part with a slug auto-derived from the user's
 * identity — used for the lazily-created default address.
 */
export function generateSendAddress(identity: string): string {
  return buildSendAddress(slugFromIdentity(identity));
}

/** Validate an address local part has the expected `{slug}-{token}` shape. */
export function isValidSendAddress(address: string): boolean {
  return /^[a-z0-9]{1,12}-[0-9abcdefghjkmnpqrstvwxyz]{5}$/.test(address);
}

/** Normalize a sender email for allowlist comparison. */
export function normalizeSenderEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pull a routing tag out of an email subject: the first `#word` token, e.g.
 * `Re: my book #scifi` → `scifi`. Returns undefined when absent.
 */
export function parseSubjectTag(subject: string | null | undefined): string | undefined {
  if (!subject) return undefined;
  const match = subject.match(/#([\p{L}\p{N}_-]{1,40})/u);
  return match ? match[1] : undefined;
}
