export type CustomHeaders = Record<string, string>;

/**
 * RFC 7230 token characters — the only ones an HTTP header name may
 * contain. `new Headers()` and `fetch` throw a TypeError on anything else
 * (`My Header` with a space is the easy mistake), and KOSyncClient's
 * per-request try/catch swallows that into a console error, so the sync
 * loop would just stop working with no user-visible signal.
 *
 * Screened in two places: `parseCustomHeadersInput` rejects it so the
 * form shows an actionable error, and `normalizeCustomHeaders` drops it
 * so values that never went through the parser — settings written by an
 * older build, hand-edited config, a value pulled from another device —
 * can't take the request path down either.
 */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const isValidHeaderName = (name: string): boolean => HEADER_NAME_PATTERN.test(name);

export const normalizeCustomHeaders = (headers?: CustomHeaders | null): CustomHeaders => {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([key, value]) => [key.trim(), String(value).trim()] as const)
      .filter(([key, value]) => isValidHeaderName(key) && value.length > 0),
  );
};

export const hasCustomHeaders = (headers?: CustomHeaders | null): boolean => {
  return Object.keys(normalizeCustomHeaders(headers)).length > 0;
};

export const parseCustomHeadersInput = (
  input: string,
): { headers: CustomHeaders; error?: string } => {
  const headers: CustomHeaders = {};

  for (const [index, rawLine] of input.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      return {
        headers: {},
        error: `Custom header line ${index + 1} must use the format "Header-Name: value".`,
      };
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key || !value) {
      return {
        headers: {},
        error: `Custom header line ${index + 1} must include both a name and a value.`,
      };
    }

    if (!isValidHeaderName(key)) {
      return {
        headers: {},
        error: `Custom header line ${index + 1} has an invalid header name.`,
      };
    }

    headers[key] = value;
  }

  return { headers };
};

export const formatCustomHeadersInput = (headers?: CustomHeaders | null): string => {
  return Object.entries(normalizeCustomHeaders(headers))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
};

export const serializeCustomHeaders = (headers?: CustomHeaders | null): string | null => {
  const normalizedHeaders = normalizeCustomHeaders(headers);
  if (Object.keys(normalizedHeaders).length === 0) {
    return null;
  }

  return JSON.stringify(normalizedHeaders);
};

export const deserializeCustomHeaders = (value?: string | null): CustomHeaders => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }

    return normalizeCustomHeaders(parsed as CustomHeaders);
  } catch {
    return {};
  }
};
