---
name: tts-word-body-lang-en-us-6248
description: "Vietnamese book read by an English TTS voice — Word's `<body lang=\"EN-US\">` beat `<html lang=\"vi\">`; parseSSMLLang only rescued bare `en`"
metadata: 
  node_type: memory
  type: project
  originSessionId: c3f74607-db31-40f6-929b-78bdf704ea90
  modified: 2026-09-17T12:42:18.084Z
---

Reported 2026-09-17 against a Vietnamese EPUB (`Chí Tôn Đặc Công`, local book hash
`1119fa1e9ab336ba77fbd585b0ae88cc`): every sentence was synthesized with
`en-US-AndrewNeural`.

**Chain:**
1. The EPUB was converted from Word. `<html lang="vi" xml:lang="vi">` is correct,
   but Word also stamps `<body lang="EN-US">`. Only those two elements in the whole
   section carry a lang.
2. `getLang` in `packages/foliate-js/tts.js:14` recurses through `parentElement`
   and returns the **nearest** ancestor with a lang — that is `body`, so `html`'s
   `vi` is never reached. Correct per HTML spec (body is more specific); the data
   is just garbage.
3. SSML comes back as `<speak … xml:lang="EN-US">`.
4. `parseSSMLLang` (`src/utils/ssml.ts`) has a safety net: *if the doc says English
   but `book.primaryLanguage` says otherwise, trust the book.* It gated on
   `lang === 'en'` exactly, so `en-US` bypassed it.
5. `BufferedTTSClient.getVoiceIdFromLang('en')` then picked the stored
   `edge-tts-en` preferred voice.

**Fix (PR #6247, branch `fix/tts-regional-en-book-language`, UNMERGED):** gate on the base subtag —
`lang.split('-')[0] === 'en'` — so `en`, `en-US`, `en-GB` all defer to the book's
declared language. An English book keeps its region variant because
`isSameLang('en-US','en')` is true.

**Verification recipe (web, no audio needed).** The web build does NOT hit the
Edge WebSocket directly — it POSTs to `/api/tts/edge`, and `edgeTTS.ts` imports
`WebSocket` from `isomorphic-ws` at module scope, so patching `window.WebSocket`
captures nothing. Patch `window.fetch` instead and read `init.body`:

```js
const of = window.fetch;
window.fetch = async function (input, init) {
  const u = typeof input === 'string' ? input : input?.url;
  if (u?.includes('/tts/edge') && typeof init?.body === 'string') console.log(init.body);
  return of.apply(this, arguments);
};
```
Then press `t` (the Toggle-TTS shortcut). Before: `{"voice":"en-US-AndrewNeural","lang":"en-US"}`
on Vietnamese text. After: `{"voice":"vi-VN-HoaiMyNeural","lang":"vi"}`.

You can also read the raw SSML live once TTS is running:
`document.querySelector('foliate-view').tts.start()` — it is null while TTS is
stopped, because `TTSController.initViewTTS` owns it. It still reports
`xml:lang="EN-US"`; the repair happens downstream in `parseSSMLLang`, which is the
point.

Reader iframes live inside shadow roots — walk `el.shadowRoot` to find them.

Related: [[tts-fixes]], [[xml-lang-namespace-selector-6088]]
