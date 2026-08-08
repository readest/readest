---
name: translation-inline-markup-1582
description: "#1582 translated text loses italics/bold — markup round-trip merged for azure+google, but default provider deepl corrupts markup so the issue stays open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 23d24f5c-e4dc-482d-b692-69a990218a23
  modified: 2026-08-07T15:01:57.868Z
---

#1582 "Translated text formatting": translations came back as plain text, losing italics, bold
and per-run font sizes ("whisper written in a smaller font"). Cause was structural — the pipeline
sent `el.textContent` and wrote back `textContent`, so markup died before the request was ever
made.

Fix: round-trip the paragraph's inline HTML. **The translator does the run-mapping**, which is
the whole reason this is tractable — send `The <b>quick</b> brown fox … the <i>lazy</i> dog` and
Bing/Google return `那只<b>敏捷</b>的棕色狐狸…<i>懒惰</i>的狗`, tags on the semantically matching
words despite the reordering. Do not try to re-align runs positionally; translators reorder.

Shipped in `src/app/reader/utils/translationMarkup.ts` (MERGED #5555, google added #5556):
extract → chunk at run boundaries → translate → sanitize → append. Gated per provider by
`TranslationProvider.preservesMarkup`.

## Provider capability is MEASURED, never taken from docs

| case | azure/bing | google | deepl |
| --- | --- | --- | --- |
| `<b>` / `<i>` / `<strong>` alone | ok | ok | ok |
| `<em>` alone | ok | ok | **tag dropped entirely** |
| bold + italic in one sentence | ok | ok | **`<b></b>` emptied, nothing bold** |
| nested, `class`, `href`, non-Latin target | ok | ok | — |

- **Google needs NO extra parameter.** Adding `format=html` makes it *strip* tags — the opposite
  of the documented intent. Verified with the exact request `google.ts` already builds.
- **DeepL is deliberately excluded.** It fails silently *and inconsistently*, which is worse than
  failing outright: it looks fine until a paragraph mixes bold and italic. Losing formatting but
  keeping correct text beats emitting markup that lies about it. DeepL proper supports
  `tag_handling=html`, but that must be set by the `/deepl/translate` service, which is **not in
  this repo** — passing the field from the client is silently ignored (same class as
  [[onedrive-oauth-callback-slash-5253]] dropping unknown fields).
- A registry test asserts the capable list is exactly `['azure','google']`, so widening it is a
  deliberate act.

## Why the issue is STILL OPEN

`DEFAULT_TRANSLATOR_CONFIG.translationProvider` is **`deepl`** (`src/services/constants.ts`), the
one provider that cannot carry markup. A user on default settings still reproduces #1582 on first
launch, so closing it would be wrong. Closing needs either the `/deepl/translate` service to set
`tag_handling`, or the default provider to change.

Also unaddressed: the follow-up comment asking for a **visual separator** between original and
translation. That is a design decision, not a defect — split it into its own issue rather than
letting it block the formatting fix.

## Constraints that shaped the implementation

- The sanitizer's tag allowlist **must stay a subset of** the paragraph-layout allowlist, because
  `:has()` inspects all descendants — otherwise preserved formatting re-breaks line-height. Both
  now read one constant, `INLINE_FORMATTING_TAGS`. See [[paragraph-layout-has-allowlist-trap]].
- Attributes use **echo validation**: an attribute survives only if that exact tag/name/value was
  in the source we sent. Keeps `<span class="whisper">`, blocks injected class/href/style/handlers.
  The response is untrusted markup headed for the book DOM — parse detached, rebuild through the
  allowlist, never `innerHTML`.
- Markup is chunked at run boundaries (tags re-opened in the next chunk) because the provider cap
  counts tags; the plain-text chunker would cut through a tag. Real academic paragraphs are
  942–3389 chars of HTML thanks to citation links, so without this the feature almost never fires.
