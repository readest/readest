---
name: dict-auto-play-pronunciation-6265
description: "#6265 auto-play dictionary pronunciation: opt-in switch, both MDict audio wirings refactored into reusable triggers; iOS first-lookup silence is a known WebKit limit"
metadata: 
  node_type: memory
  type: project
  originSessionId: b2947cae-6663-46d8-82f6-a1b88584c130
  modified: 2026-09-18T16:41:14.739Z
---

Issue #6265 (FR): MDX/MDD dictionaries carry pronunciation audio, but playing it always
cost a second tap on the speaker. MERGED #6280 (030cbbed5) 2026-09-18 — opt-in switch.
Two commits: 5c4fd268f feature, 5ba92f0fa the CodeRabbit review fixes below.

**Shape of the change.** `DictionarySettings.autoPlayPronunciation` (default `false`) +
`DictionaryLookupContext.autoPlayPronunciation`, forwarded from `useDictionaryResults`'s
lookup fan-out. UI = `SettingsSwitchRow` in a new `Pronunciation` BoxedList in
`CustomDictionaries.tsx`, right under the existing `Appearance`/font-scale box. Rides the
existing whole-field LWW dictionary settings sync — add the path to BOTH lists in
`services/sync/adapters/settings.ts` (the general whitelist AND
`SETTINGS_DICTIONARY_FIELDS`), same as `fontScale`.

**The provider refactor is the real content.** `mdictProvider.ts` had two independent
audio wirings with near-identical inline click listeners:
1. `wireMdxAnchors` — `sound://path.ext` hrefs.
2. `wireMdictAudioOnclick` — the Vocabulary.com `onclick="v0r.v(this,'KEY')"` rewrite.

Both now build an `AudioCandidate { el, play }` and push it onto a shared array; the
click listener just calls `play`. **Array order is NOT document order** — each pass
sweeps the whole entry, so their finds interleave in the markup; auto-play sorts with
`compareDocumentPosition` (`inDocumentOrder`) before choosing. Shipping without that sort
was a real bug caught in review: a `v0r.v` control ahead of a `sound://` anchor still
lost. `play` resolves `boolean` (true only once `playDictAudio` ran) and auto-play walks
the sorted list until one starts — a control whose recording is absent from the MDD used
to end the attempt and leave the entry silent. **The prime must stay the first
statement** so it still runs synchronously before the first `await` when invoked from a
click — that is the whole #6018 WebKit unlock (see [[mdict-audio-pos-image-6018]]).
The auto-play loop fires after the shadow root is assembled, right before the
`{ ok: true }` return, and bails on `ctx.signal.aborted`.

**Only ONE provider is armed.** `useDictionaryResults` fans out to every definition
provider concurrently and they ALL speak through the module-scoped `dictAudio`, so arming
each one let whichever resolved its bytes last cut off the others, in completion order.
Fix = `autoPlayProviderId` (first `kind === 'mdict'` in `definitionProviders`), and the
ctx flag becomes `autoPlayPronunciation && provider.id === autoPlayProviderId`.
`getEnabledProviders` iterates `settings.providerOrder`, so "first" is the user's
configured top dictionary. Declined the reviewer's bigger fix (providers returning audio
candidates for the hook to sequence) — a lookup-contract change across all providers whose
only gain is falling back to a lower-ranked dict when the top one lacks that word.

**`.spx` registers NO trigger.** The Speex guard used to live inside the click listener
together with a deprecation toast; auto-play running that path would toast on every single
lookup. Hoisted to `const isSpeex` outside: the click handler still toasts, `audioCandidates`
only gets non-Speex entries.

**Known limit, stated in the PR and in a code comment:** WebKit only lets a media element
start from a user gesture, and the MDD read is async, so on iOS the first lookup of a
session is silent until one manual speaker tap unlocks the shared module-scoped
`dictAudio`; it stays unlocked afterwards. Desktop + Android play from the first lookup.
Priming at the reader's word-tap would fix iOS but means exporting `primeDictAudio` and
coupling the annotator to one provider's internals — deliberately NOT done.

**Test trap:** `CustomDictionaries.test.tsx`'s `getToggles` counted EVERY
`input[type=checkbox]` in the panel, so adding any settings switch broke two unrelated
system-dictionary-lock tests. Scoped it to `.toggle-sm` — provider rows use the compact
size, `SettingsSwitchRow` deliberately uses the default size (its own doc comment says so).
Any future switch in that panel is now safe.

**Verified:** `pnpm test` 11323 green (10 new), lint + format clean. Chrome `dev-web` on
port 3007 (3000 was busy — see [[next16-dev-lock-and-chrome-verify]]), zh-CN dark: the
section renders in the boxed-list chassis and the toggle survives a full reload through
the real save path. NOT device-verified against a real MDX/MDD — the 2.5 GB OALD9 `.mdd`
at `~/Documents/books/issues/6018/` can't go through a browser file picker.

`pnpm run i18n:extract` also picked up `Pull-Down to Bookmark`, left untranslated by
#6278 — translated along with the 3 new strings across all 34 locales.

**i18n RULE learned here:** before writing a new translation, check whether the locale
already ships an equivalent string and REUSE its value. My fresh translations drifted in
terminology in **32 of 34** locales against the existing `Pull down to add bookmark` —
`fr` "signet" vs "marque-page", `ta` "புத்தகக்குறி" vs "புக்மார்க்", `tr` "yer imi" vs
"yer işareti" — which would have shown one gesture under two names. CodeRabbit flagged 5;
the class check (`json.load` both keys per locale, diff them) found the rest.
