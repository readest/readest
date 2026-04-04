export type OPDSCustomHeaders = Record<string, string>;

export const normalizeOPDSCustomHeaders = (
  headers?: OPDSCustomHeaders | null,
): OPDSCustomHeaders => {
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([key, value]) => [key.trim(), String(value).trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
};

export const hasOPDSCustomHeaders = (headers?: OPDSCustomHeaders | null): boolean => {
  return Object.keys(normalizeOPDSCustomHeaders(headers)).length > 0;
};

export const parseOPDSCustomHeadersInput = (
  input: string,
): { headers: OPDSCustomHeaders; error?: string } => {
  const headers: OPDSCustomHeaders = {};

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

export const formatOPDSCustomHeadersInput = (headers?: OPDSCustomHeaders | null): string => {
  return Object.entries(normalizeOPDSCustomHeaders(headers))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
};

export const serializeOPDSCustomHeaders = (headers?: OPDSCustomHeaders | null): string | null => {
  const normalizedHeaders = normalizeOPDSCustomHeaders(headers);
  if (Object.keys(normalizedHeaders).length === 0) {
    return null;
  }

  return JSON.stringify(normalizedHeaders);
};

export const deserializeOPDSCustomHeaders = (value?: string | null): OPDSCustomHeaders => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }

    return normalizeOPDSCustomHeaders(parsed as OPDSCustomHeaders);
  } catch {
    return {};
  }
};
