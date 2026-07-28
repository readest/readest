---
name: rlm-bidi-mark-shaping-5216
description: "#5216 Persian RLM half-space: PR #5361 merged but its sanitizer entity restoration is dead code; real cause is font-fallback-dependent shaping"
metadata: 
  node_type: memory
  type: project
  originSessionId: f73c11aa-76f1-40b4-b703-5c720379bd6c
  modified: 2026-07-27T15:57:39.877Z
---

#5216 (Persian ebooks using U+200F RLM as a half-space render joined instead of
half-spaced). PR #5361 merged 2026-07-27 (`44953f5`) and auto-closed the issue,
but its `sanitizer.ts` half cannot have any effect — verified empirically:

- `XMLSerializer.serializeToString` **never** emits `&#x200f;` / `&#8206;` /
  `&#8207;`. Confirmed in Chromium, WebKit, and Firefox: the literal character
  always survives. The XML serialization spec only escapes `& < > "`.
- Ran the real `sanitizerTransformer` (DOMPurify + XMLSerializer) in Chromium
  with three input forms — literal `‏`, `&#x200f;`, `&#8207;`. All three
  outputs contain the literal RLM, never an entity. The four added
  `replaceAll` calls are unreachable.
- The repro EPUB from the issue holds **9 literal U+200F** chars, zero entities.

So the `&nbsp;`/`&#160;` round-trip in `sanitizer.ts` is NOT a general pattern to
copy: `&nbsp;` needs it because it is not a predefined XML entity, and the
` ` → `&nbsp;` leg exists to re-encode for readability. Nothing else needs
protecting from the serializer.

**Real cause** — U+200F is `Joining_Type=Transparent` in Unicode, so a conforming
shaper joins straight through it. Whether the join visibly breaks is
**font-fallback dependent**: if the RLM falls to a different font than the
surrounding Arabic, Chrome splits the shaping run and the join breaks. Measured
in desktop Chromium at 48px sans-serif: RLM 105.7px == ZWNJ 105.7px vs 88.0px
with no mark (join breaks); on the reporter's Android WebView 150 it stays
joined. Bidi CSS (`unicode-bidi: isolate/plaintext/bidi-override`) changes
nothing.

A fix has to change the **content**, not the entity round-trip: normalize a
misused RLM to ZWNJ only when it sits between two Arabic-script letters, leaving
legitimate bidi RLM around digits and neutrals alone. Belongs in a transformer
(`src/services/transformers/`), not the sanitizer.

The reporter also says Proofread replacement rules with U+200F patterns don't
work — separate, unverified sub-issue.

Also in that PR: `paragraph.ts` `INVISIBLE_TEXT_PATTERN` widened
`​-‍` → `​-‏`. Independently reasonable (LRM/RLM are
invisible for the "is this paragraph empty" check), unrelated to the render bug.

Related: [[bug-patterns]], [[feedback_use_worktree]]
