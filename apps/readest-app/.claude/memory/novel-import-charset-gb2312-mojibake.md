---
name: novel-import-charset-gb2312-mojibake
description: Web-novel import showed mojibake because Response.text() always decodes UTF-8; fixed with a browser-order charset sniffer in defaultFetchPage
metadata: 
  node_type: memory
  type: project
  originSessionId: 90525b66-230a-4e1c-b0dc-df152f7713e0
  modified: 2026-09-04T06:10:23.151Z
---

Web-novel import (Library -> Import -> From Web Novel) rendered every extracted string as
mojibake on GB2312/GBK sites. Reported 2026-09-04 against
`https://www.trxs.cc/tongren/11542.html`: title came out `����Ħ˹С��ز����ܳ�Ϊ��Ȯ��`
instead of `福尔摩斯小姐必不可能成为败犬！(五月不行)`, all 469 chapter names likewise.

**Root cause:** `defaultFetchPage` in `src/services/novel/novelImport.ts` used
`await res.text()`. Per the fetch spec `Response.text()` **always** UTF-8-decodes and
ignores the declared charset — so this was never platform-specific (the reporter guessed
Windows; macOS/Android/iOS/Windows all failed identically). `trxs.cc` sends
`Content-Type: text/html` with **no charset** and declares `charset=gb2312` only in a
`<meta http-equiv="Content-Type">` tag at byte offset 89.

**Fix:** read `res.arrayBuffer()` and decode via a new exported `decodeHtmlBody(bytes,
contentType)` that follows the browser sniffing order — BOM, then HTTP `Content-Type`
charset, then a 1024-byte `<meta>` prescan (handles both `<meta charset>` and the
`http-equiv` form), then invalid-UTF-8 -> `gb18030` for pages declaring nothing.
`gb18030` decodes every byte sequence, so it never throws.

**Diagnosing this class of mojibake from the string alone:** interleaved U+FFFD with a few
real Latin-Extended chars (`Ħ˹`) means GBK bytes decoded as UTF-8 — most GBK pairs are
invalid UTF-8 (-> U+FFFD) but pairs with lead C2-DF and trail 80-BF decode to real
U+0080-U+07FF chars. `Ħ` = C4 A6 = 摩 in GBK, `˹` = CB B9 = 斯. Confirm with
`raw.decode('utf-8', errors='replace')` vs `raw.decode('gb18030')` in Python.

**Verify recipe:** Node's `TextDecoder` has the full legacy set in vitest, so gb2312/big5
fixtures work in unit tests. Encode fixture bytes as `Uint8Array.from([...])` literals —
`bytesOf('ascii', GB2312_BYTES)` mixing UTF-8 template strings with legacy bytes silently
produces a broken fixture (a plain `第 1 章` in the string becomes UTF-8 inside a gb2312
document). Annotate byte-builder return types as `Uint8Array<ArrayBuffer>`, not
`Uint8Array`, or `new Response(bytes)` fails `tsc` on `BodyInit`.

Xiaomi-VERIFIED 2026-09-04 end to end: correct title + all 469 chapter names in the import
dialog, and a 2-chapter import rendered 3323 chars with **0** U+FFFD and 0 stray
Latin-Extended (74.2% CJK).

**Also fixed in the same pass (adjacent, pre-existing, had been masked by the mojibake):**
the author parsed as `五月不行日期：2026-08-24` instead of `五月不行`. The `作者[:：]` fallback
regex ran over flattened `body.textContent`, and its stop set (`\s，,。；;、`) contained no CJK
label, so it swallowed the adjacent `日期：<date>`. Replaced with `bylineAuthor()`, which walks
text nodes (`doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)`) so the name can be read out of
the `<a>` that usually wraps it, with a 3-node lookahead for `作者：` ending its own text node.

**A generic "next CJK label" cut does NOT work** — the tempting
`split(/(?=[\u4e00-\u9fff]{1,4}\s*[:：])/)` matches a 4-char window straddling the name
boundary: on `五月不行日期：` the first match is `不行日期：`, yielding `五月`. Nothing generic can
tell "name + label" from "all label" when no separator exists, so `NEXT_FIELD_LABEL` names the
labels explicitly (日期|时间|更新|状态|字数|分类|类别|类型|标签|来源|最新).

PR #6052 MERGED 2026-09-04 as 070c90b8a (2 commits: a62a4f95c the fix, 04d848551 the review
follow-ups).

**CodeRabbit review caught two real defects in the first commit, both reproduced before
fixing.** (1) The byline lookahead walked up to 3 text nodes past the label, so an empty
`作者：` followed by `日期：` and chapter links returned `第1节` (a chapter title) as the author;
the suggested "break on the next field label" only covers the date variant, so the rule became
"only the FIRST NON-BLANK node can hold the name" and `BYLINE_LOOKAHEAD` went away. (2) The
meta prescan matched raw text: it accepted a declaration inside an HTML comment (corrupting a
valid UTF-8 page) and captured `charset='big5'` as the label `'big5'`, which `TextDecoder`
rejects, dropping a Big5 page into the GB18030 fallback. **Fix = parse the 1024-byte window
with `DOMParser` and read `meta[charset]` / `http-equiv` as ATTRIBUTES** instead of pattern
matching, which hands comments, script contents and all quoting styles to the parser.
`charsetOf` also gained single-quote tolerance for the header path.

Related: [[feedback-always-verify-on-xiaomi]], [[bug-patterns]]
