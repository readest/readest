/**
 * Per-site extraction rules. Run *before* Readability — when a rule matches,
 * we trust the selectors over Readability's scoring, because sites that fail
 * Readability fail it consistently (custom containers, JS-revealed content,
 * marketing chrome that scores higher than the article).
 *
 * Stays a fast path, not a wall: if a rule's content selector doesn't match
 * or yields too little text, the pipeline falls through to Readability and
 * then to the generic selector fallback. A stale rule never silently loses
 * content — worst case it adds one no-op query before the real extraction.
 *
 * Designed as a pure-data module with no DOM dependencies so the future
 * Phase 4 browser extension's content script can import it verbatim and run
 * the same rules in the user's authenticated tab.
 */
export interface SiteRule {
  name: string;
  /** Match by parsed URL. Hostname is the most reliable; URL pathnames
   *  change too often. */
  match: (url: URL) => boolean;
  /** CSS selector for the article body. The element's innerHTML becomes
   *  the chapter content. */
  content: string;
  /** Override Readability's title. */
  title?: string;
  /** Override Readability's byline. */
  byline?: string;
  /** CSS selector for an `<img>` (or element with a usable `src`) that
   *  represents the author / public-account avatar. Used by the cover
   *  generator as a circular avatar — visually richer than a site-wide
   *  favicon. Best-effort: when the selector misses or the fetch fails,
   *  the cover falls back to the favicon. */
  authorImage?: string;
  /** Selectors to remove from the content before bundling (e.g. "open in
   *  app" CTAs, QR codes, share buttons). */
  strip?: string[];
}

const RULES: SiteRule[] = [
  {
    // Articles wrap the body in `<div id="js_content">` with
    // `visibility:hidden; opacity:0`, then JS reveals it. Readability mis-
    // scores the page because the recommendation rail outweighs the
    // hidden article in its heuristics.
    name: 'mp.weixin.qq.com',
    match: (u) => u.hostname === 'mp.weixin.qq.com',
    content: '#js_content',
    title: '#activity-name, h1.rich_media_title',
    byline: '#js_name, .rich_media_meta_nickname',
    authorImage:
      '.profile_avatar img, .rich_media_meta_nickname_avatar img, .weui_media_avatar img, img.identity_icon, .wx_follow_avatar img',
    strip: [
      // Inline QR codes (PC + mobile variants)
      '.qr_code_pc',
      '#js_pc_qr_code',
      // Reward / tip popups
      '.reward_area',
      '.reward_qrcode_area',
      '.reward_user_info',
      // Promotional inserts
      '.promotion_card',
      // Cross-app CTAs
      '.weui-dialog_appmsg',
      '.open_in_weixin_wrap',
    ],
  },
  {
    name: 'x.com',
    match: (u) => u.hostname === 'x.com' || u.hostname.endsWith('.x.com'),
    content: '[data-testid="twitterArticleReadView"]',
    title: '[data-testid="twitter-article-title"]',
    // The User-Name container holds both the display name and the @handle.
    // The handle's anchor is keyboard-hidden via `tabindex="-1"`; the
    // display-name anchor has no tabindex. Picking the non-tabindexed
    // anchor lets us grab just "mousepotato" without the "@iluciddreaming"
    // suffix. The verified-account SVG sits next to the name but
    // contributes no text content, so textContent stays clean.
    byline: '[data-testid="User-Name"] a:not([tabindex])',
    // `UserAvatar-Container-<handle>` — prefix match keeps the rule
    // handle-agnostic. The inner <img> uses `_x96` size variant; the
    // cover generator may upscale via URL rewriting.
    authorImage: '[data-testid^="UserAvatar-Container-"] img',
    strip: [
      // Reply / Repost / Like / Bookmark / Share / Views row at top.
      // aria-label is locale-specific, so match by the structural fact
      // that this group contains a "reply" button.
      '[role="group"]:has([data-testid="reply"])',
    ],
  },
];

/**
 * Universal meta-tag fallbacks for fields that a per-site rule can't
 * extract — either because no rule matched the host, or because the
 * site shipped a frontend redesign and our CSS hooks no longer find
 * anything. Every reputable publisher emits these tags for crawlers
 * and link unfurlers (Twitter Card, Slack, iMessage previews), so
 * they're the most stable fallback short of giving up.
 *
 * Values live in the `content` attribute, not textContent — read with
 * `el.getAttribute('content')`. The lists are ordered by reliability:
 * try the first that matches.
 *
 * No `content` (body) fallback here — Readability already owns that
 * path when a site rule's content selector misses, and Readability
 * does a better job than any meta tag would.
 */
export const META_FALLBACK = {
  title: ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[name="title"]'],
  byline: [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="twitter:creator"]',
    'meta[property="og:site_name"]', // last-ditch: at least name the publication
  ],
  authorImage: [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ],
} as const;

/** Find the rule matching `url`, if any. Returns null on parse error. */
export function findSiteRule(url: string): SiteRule | null {
  try {
    const parsed = new URL(url);
    return RULES.find((r) => r.match(parsed)) ?? null;
  } catch {
    return null;
  }
}
