---
name: opds-html-description-4503
description: "OPDS publication descriptions showed raw HTML tags; double-escaped type=\"text\" summaries + unsanitized innerHTML; fix decodes-if-fully-escaped then sanitizes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73fd2a21-ea89-4cdb-bbbd-23256a6ae5a2
---

Issue #4503 (FR, but a real bug): OPDS publication detail descriptions rendered
raw HTML — literal `<p>`, `</p>`, `&quot;`, `&#x27;` text — while Thorium renders
them. Reporter's feed served the same Gutenberg book (51726) via an aggregator.

**Root cause** (confirmed empirically by running foliate `getPublication` in jsdom):
the aggregator serves the description as an Atom `type="text"` `<summary>` whose
HTML was escaped *twice*. foliate's `getContent` (`packages/foliate-js/opds.js`)
only un-escapes for `type="html"`/`"xhtml"`; for `text` it returns `textContent`
verbatim, so the value stays `"&lt;p&gt;...&amp;quot;Wall&amp;quot;..."`.
`PublicationView` then dumped `content.value` straight into
`dangerouslySetInnerHTML` (also **unsanitized — an XSS sink** for arbitrary
remote feeds). The browser decodes one entity level → shows the still-escaped
`<p>`/`&quot;` as literal text. Single-escaped `type="text"` renders fine (value
already has real tags); only *double*-escaped breaks. type=html/xhtml render fine.

**Fix:** new helper `src/app/opds/utils/opdsContent.ts` `getOPDSDescriptionHtml()`:
decode one extra entity level **only when the value is entirely escaped markup**
(`/&lt;\/?[a-z]/i` present AND no real `/<[a-z]/i` tag — so mixed content like
`<p>see &lt;code&gt;</p>` is left literal), then `sanitizeHtml()` (the shared
DOMPurify sanitizer in `@/utils/sanitize` — generic, reused; note its
ALLOWED_TAGS has no `div`, so xhtml's `<div xmlns>` wrapper is unwrapped,
harmless). Wired into `PublicationView` via `useMemo`. Decode-then-sanitize
order matters: scripts hidden behind double-escaping are still stripped.
(PR #4510 also moved `sanitizeHtml`/`sanitizeForParsing` out of
`services/send/conversion/` into `@/utils/sanitize`, alongside `sanitizeString`.)
Exported `OPDSContent` from `types/opds.ts` for the helper's param.

Scope: only the detail view renders description HTML. `PublicationCard` shows no
summary; `NavigationCard` renders `SYMBOL.SUMMARY` as React-escaped plain text
(getSummary only returns `type==='text'` values) — both correct, untouched.

Verifying which render path produces "raw tags": React `{value}` text-escapes
(shows `&copy;` literally); `dangerouslySetInnerHTML` decodes one level (shows
literal `<p>` only if value is `&lt;p&gt;`). The screenshot showed literal `<p>`
AND `&quot;` → double-escaped innerHTML path, not the dead `description` path
(foliate's `getPublication` never sets `metadata.description`). Related:
[[opds-firefox-strict-xml-4479]].
