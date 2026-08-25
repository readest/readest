import type { WebSource } from '@/types/webSource';

/** Trim, add `https://` when no scheme is given, and require http(s). */
export function normalizeWebSourceUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function webSourceNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function addWebSource(list: WebSource[], name: string, url: string): WebSource[] {
  const trimmedName = name.trim() || webSourceNameFromUrl(url);
  const existing = list.find((s) => s.url === url);
  if (existing) {
    return list.map((s) => (s.id === existing.id ? { ...s, name: trimmedName } : s));
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return [...list, { id, name: trimmedName, url }];
}

export function removeWebSource(list: WebSource[], id: string): WebSource[] {
  return list.filter((s) => s.id !== id);
}
