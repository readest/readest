---
name: tts-ruby-furigana-readings-5539
description: "#5539 TTS speaks Japanese ruby <rt> readings instead of base kanji — filter-level swap, foliate fragmentToSSML + Overlayer patches"
metadata: 
  node_type: memory
  type: project
  originSessionId: 992bb36b-feb4-4a14-ad42-a209c7a02ed1
  modified: 2026-08-07T02:20:05.406Z
---

#5539 (2026-08-07): TTS spoke the base kanji and let the engine guess the reading.
MERGED #5546 (22308485f) + foliate-js#67 (11b9497). Worktree removed.
Real-book verify still PENDING — everything was checked against a synthetic 8-variant EPUB, never a
commercial light novel. Ask the reporter (He1lscythe, who has a volume with 1,695 ruby annotations)
to retest on the next release.

**The swap must happen in the node filter, never by rewriting text.** `#ttsDoc` is usually the
LIVE rendered document (`#getLiveSectionDoc`), and even for background sections the doc must stay
content-identical or highlight CFIs drift (the #5406 rule in `transformDoc.ts`). So
`src/utils/ruby.ts` `isMutedRubyNode()` decides which SIDE of each ruby pair the walker drops;
both the live-range walk and the cloned-fragment walk use the same filter, so marks stay aligned.

**Gate is kana-ness of the `<rt>`, not book language.** `isKanaReading` = at least one real kana
letter AND nothing but kana / ー / ・ / voicing marks. That self-gates to Japanese and leaves
emphasis dots (傍点 `・﹅●、`), pinyin, zhuyin, latin/kanji glosses and `[cfi-inert]` WordLens
glosses on their old behaviour. Decision is PER base-run/rt pair, so an empty `<rt>` padding
okurigana keeps its base — 振り仮名 reads ふりがな, not ふがな. `・` is scx=Katakana, so
"at least one kana letter" must use explicit letter ranges, not `\p{scx=Katakana}`.

**Two foliate-js patches were required** (each proven by a failing test):
- `fragmentToSSML` applied `nodeFilter` to ELEMENTS ONLY. A group-ruby base is a bare text child
  of `<ruby>` (no `<rb>`), so it leaked into the speech: "数多あまたの星". Filter text nodes too.
- `Overlayer.#splitRange` collected rects from `rt/rp/rtc/[cfi-inert]`, drawing a detached box over
  the furigana. Now rejected — this is also the fix for "rt should never be highlighted for
  annotation".

Those two are complementary with `expandRangeOverRuby` in `TTSController.#getHighlighter`: a TTS
range anchored on the reading lies INSIDE the `<rt>`, whose rects are now dropped, so without the
expansion nothing would paint at all.

`createTTSNodeFilter` moved out of TTSController into `src/services/tts/nodeFilter.ts` so the tests
exercise the real filter instead of a duplicated config (the "MUST segment identically" invariant).
`wordHighlight.isInertText` now delegates to `isMutedRubyNode` so Edge word-boundary offsets match
the spoken reading.

Chrome-verified against a purpose-built 8-variant JA EPUB: `fv.tts.start()/next()` dumped
あまた / ヒエログリフ / かんじ / ふりがな / あまた / 本当(dots kept) / すみだ / ひとけ.
`fv.tts.setMark('0')` runs the controller's real highlighter — box hugs the base line, furigana
sits outside it. See [[browser-verify-readest-web-recipe]]; note Edge TTS WebSocket fails on local
dev, so drive `view.tts` directly instead of waiting for audio.

Same branch also carries an unrelated fix: TTSMiniPlayer / TTSPlayerSheet dropped a
`coverImageUrl` that fails to load, which had been reserving a blank 128px band in the sheet.
