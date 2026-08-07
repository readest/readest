export type CustomHeaders = Record<string, string>;

export const normalizeCustomHeaders = (headers?: CustomHeaders | null): CustomHeaders => {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([key, value]) => [key.trim(), String(value).trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
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
