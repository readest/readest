const FEED_LINK_SELECTOR =
  'link[rel="alternate"][type="application/rss+xml"],' +
  'link[rel="alternate"][type="application/atom+xml"],' +
  'link[rel="alternate"][type="application/feed+json"],' +
  'link[rel="alternate"][type="application/json"]';

export function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const urls: string[] = [];
  for (const link of Array.from(doc.querySelectorAll(FEED_LINK_SELECTOR))) {
    const href = link.getAttribute('href');
    if (!href) continue;
    try {
      urls.push(new URL(href, baseUrl).toString());
    } catch {
      // skip unparseable href
    }
  }
  return urls;
}
