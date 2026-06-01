export function isEndpointProtocolValid(endpoint: string): URL | null {
  try {
    const parsed = new URL(endpoint);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}
