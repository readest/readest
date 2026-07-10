import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getProxiedURL, needsProxy } from '@/app/opds/utils/opdsReq';
import { isTauriAppPlatform } from '@/services/environment';
import { parseFeed } from './feedParser';
import { discoverFeedUrls } from './feedDiscovery';
import type { ParsedFeed } from '@/types/rss';

export async function fetchFeedText(url: string): Promise<string> {
  const doFetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const target = !isTauriAppPlatform() && needsProxy(url) ? getProxiedURL(url) : url;
  const res = await doFetch(target, { method: 'GET' });
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status} ${res.statusText}`);
  return res.text();
}

const looksLikeHtml = (body: string): boolean => {
  const t = body.replace(/^﻿/, '').trimStart().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
};

export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
  const body = await fetchFeedText(url);
  try {
    return parseFeed(body, url);
  } catch (err) {
    if (looksLikeHtml(body)) {
      const [discovered] = discoverFeedUrls(body, url);
      if (discovered) return parseFeed(await fetchFeedText(discovered), discovered);
    }
    throw err;
  }
}
