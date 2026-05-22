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
];

/** Find the rule matching `url`, if any. Returns null on parse error. */
export function findSiteRule(url: string): SiteRule | null {
  try {
    const parsed = new URL(url);
    return RULES.find((r) => r.match(parsed)) ?? null;
  } catch {
    return null;
  }
}
