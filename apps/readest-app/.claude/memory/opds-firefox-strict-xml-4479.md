---
name: opds-firefox-strict-xml-4479
description: OPDS feeds fail on Firefox but work on Chrome — strict DOMParser parsererror on junk after root; parseOPDSXML recovery
metadata: 
  node_type: memory
  type: project
  originSessionId: 9539d003-7df3-4643-99ca-bdee69be1b3f
---

#4479 (MEK catalog `bookserver.mek.oszk.hu`, a PHP backend `teljes.php`): OPDS feeds load on Chrome but on Firefox clicking anything shows loading then silently navigates back. Root cause: the server emits a valid Atom feed followed by **trailing junk after `</feed>`** (a stray PHP warning / extra tag / text). Chrome's `DOMParser` ignores it; **Firefox's strict parser replaces the WHOLE document with a `<parsererror>`** ("junk after document element" / "text data outside of root node", Mozilla namespace `http://www.mozilla.org/newlayout/xml/parsererror.xml`). The code then sees a non-`feed` root → treats response as HTML → finds no OPDS link → `router.back()`.

**jsdom mirrors Firefox exactly** (same strict behavior + same parsererror namespace), so this reproduces in vitest — no need for a real browser. Detect via `doc.documentElement.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0`. Leading whitespace before the root is VALID XML (not the issue); trailing non-whitespace is the killer.

**Fix:** `parseOPDSXML(text)` helper in `src/app/opds/utils/opdsUtils.ts` — parse, and on parser error re-parse the slice from the first element start tag (`/<([A-Za-z_][\w.:-]*)/`) to its last matching `</root>` close tag (drops leading prolog + trailing junk). Returns the original error doc if recovery fails (no regression — falls through to existing HTML branch). Wired into all 3 OPDS XML parse sites: `page.tsx` (reader nav), `validateOPDSURL` (opdsUtils, adding catalog), `feedChecker.ts` (subscriptions/auto-download). feedChecker also had the #4181 detection bug — switched `text.startsWith('<')` → `looksLikeXMLContent(text)` (the MEK feed has ~13 leading newlines + no `<?xml?>` decl), else the parse fix is unreachable there.

This is the same MEK server family as [[empty-start-cfi-sync]]-style "tolerate broken servers" work; related #4181 = leading-whitespace detection (`looksLikeXMLContent`).

NOT fixed (separate, out of scope unless asked): #4479 also reports Android **download** failures (acquisition links point to `mek.oszk.hu/.../*.epub`; works in plain browser, red "download failed" toast in app) — distinct from the XML parse issue.
