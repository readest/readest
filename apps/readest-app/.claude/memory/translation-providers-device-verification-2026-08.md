---
name: translation-providers-device-verification-2026-08
description: en->zh verification of all four translation providers on the Xiaomi (2026-08-28) - what works, DeepL zh-Hant 500, Google client=gtx 429, Azure latency numbers
metadata:
  type: project
---

Verified 2026-08-28 on Xiaomi 368b0948 by running each provider's exact request
logic (including `normalizeToShortLang`) inside the app's own webview through the
real Tauri HTTP stack, plus an end-to-end UI check.

**All four work for en->zh-CN.** Google, Azure, Yandex, DeepL all returned correct
Simplified Chinese. Azure + Google preserved inline markup and repositioned tags.
UI check: target `zh-CN` + provider `azure` rendered a full bilingual chapter and
wrote 24 fresh `azure:AUTO->zh-CN` cache entries with `<em class="calibre6">` intact.

**DeepL Traditional was OUR bug, not the server's.** `deepl.ts` did
`normalizeToShortLang(target).toUpperCase()`, and normalizeToShortLang already
returns the canonical `zh-Hant` -- the blanket uppercase turned it into
`ZH-HANT`, the one casing the service 500s on. Measured against the live
endpoint: `ZH-HANT` and `ZH-TW` -> 500, but `ZH-Hant` / `zh-Hant` -> 200 with
real Traditional Chinese, and `ZH-HANS` / `ZH-Hans` / `zh-Hans` / `ZH` all 200.
Same rule applies to `source_lang`. FIXED: `toDeepLLang()` upper-cases only the
primary subtag, so zh-TW/zh-HK/zh-MO -> `ZH-Hant`, zh-CN -> `ZH-Hans`,
en -> `EN`, AUTO -> `AUTO`. All four zh locales live-verified.
LESSON: when a server 500s on one enum value and accepts its sibling, suspect
the exact string you are sending before blaming the service.

**Yandex has no Traditional target at all** -- its `normalizeLang` collapses every
zh variant onto `zh`, which is Simplified, so a zh-TW reader was handed
Simplified text labelled as their language. FIXED by converting the reply with
simplecc (`s2t`) when the requested target normalizes to `zh-Hant`. Unlike
DeepL there is no target code to ask for, so local conversion is the only fix.

**Google 429 ROOT CAUSE = the Tauri Rust HTTP client, not the network.** Measured
on device, same URL / same instant / same `client=gtx`: `window.fetch` (the
webview's Chromium stack) answered **200 five times in a row** while `tauriFetch`
answered **429**. Google's abuse page is "your computer or network may be sending
automated queries". The block on the Rust client outlived a restart and 4+ min of
polling; the Mac on the SAME exit IP (103.181.1.46) was fine for a while and then
got 429'd too -- anything that is not a real browser eventually gets flagged.
FIX SHIPPED: google.ts now always uses `window.fetch`, never the Tauri HTTP
plugin. The endpoint is CORS-open (body readable cross-origin) and
`https://translate.googleapis.com` was ALREADY in the app's `connect-src` CSP, so
no config change was needed. Also added `MAX_CONCURRENT_REQUESTS = 4` -- google
previously had NO cap at all (`text.map` + `Promise.all`), unlike azure (3/10) and
yandex (3). Device-VERIFIED on the rebuilt APK: popup `must` -> `必须` via Google,
and a fresh chapter wrote 29 `google:AUTO->zh-CN` cache entries with
`<em class="calibre6">` markup intact.

**A blind alley worth remembering:** `client=at` and
`clients5.google.com/translate_a/t?client=dict-chrome-ex` DO answer 200 while
`client=gtx` is 429, which looks like per-bucket throttling and is a tempting fix
(`at` is a true drop-in -- same `segments[]` shape, preserves markup). It is a
mirage: the buckets are exhaustible too, ~18 test requests spent `at` as well.
Swapping client params is whack-a-mole; the transport is the real variable.

**Azure is slow because Bing is slow, not because of the token.** Token page scrape
1.5-1.7s (627KB) but already cached ~59min in memory. Each *warm* translate call
2-8s on device, and 2.1/2.8/6.6s from the Mac on a different path -- the response
now says `usedLLM: true`. Google on the same paths: 0.5-0.9s.
10 real paragraphs, on device: **10.4s** at the old 3-concurrent cap, **3.6s** at 10
concurrent, **4.8s** newline-batched into one request (10 lines in -> 10 out, aligned).
Bing accepts newline-joined text and returns aligned newlines; 12 concurrent direct
to bing.com all answered 200 (no 429).
SHIPPED: `MAX_CONCURRENT_REQUESTS` split into `PROXY_MAX_CONCURRENT_REQUESTS = 3`
(web, the proxy budgets per user) and `DIRECT_MAX_CONCURRENT_REQUESTS = 10` (Tauri,
no proxy in path). Batching and token persistence were measured but NOT implemented.

**Gate gotcha:** the reader's Translation toggle is greyed out (`opacity-50`,
`cursor-default`, not `disabled`) when `isTranslationAvailable` is false -- an
English book with the translate target still on `en` looks broken but is correct.
Set Settings -> Language -> "Translate To" to a different language first.

## Shipped

MERGED as PR #5913 (merge commit e782af530, 2026-08-28); branch deleted locally
and on the remote. Four provider fixes (DeepL `ZH-Hant` casing, Yandex simplecc
`s2t` for Traditional, Google via window.fetch + cap 4, Azure cap 3->10 on Tauri)
plus the translator popup grid and the daisyUI 5 select/picker layout fixes.

CodeRabbit review caught one real gap: `w-auto` only tracks the selected value
while `appearance: base-select` applies. Without it a native select sizes to its
WIDEST option, and the popup feeds it the whole language list -- measured 240px
vs 49px in a browser test. Fixed with `[field-sizing:content]`. `SettingsSelect`
is NOT affected (no `w-auto`; its width comes from daisyUI's clamp, 228px in all
configurations). RULE that came out of it twice this session: a layout guard that
passes on the path that already works guards nothing -- drive the broken path.
