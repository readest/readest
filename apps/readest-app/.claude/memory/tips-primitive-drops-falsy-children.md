---
name: tips-primitive-drops-falsy-children
description: "Tips settings primitive rendered an empty bullet for every {cond && <li>} whose condition was false, because React.Children.map keeps boolean slots. Fixed 2026-09-03 by switching to Children.toArray."
metadata:
  type: project
---

`src/components/settings/primitives/Tips.tsx` wraps each child in its own `<li>` with a bullet dot. It used `React.Children.map`, which **keeps** `null`/`undefined`/`false` slots and hands them to the callback - so every caller-written `{cond && <li>...</li>}` with a false condition rendered a visible dot with no text.

Fix: `React.Children.toArray(children).map(...)`. MERGED in PR #6049 (squash `9c235ed8f`). `toArray` (unlike `Children.map`) drops null/undefined/boolean children. One-line change, covers every call site.

Two screens were affected in production: **Nearby BookDrop** settings (5 bullets, last 2 blank - `paired.length > 0` and `status?.multicastError`) and the **S3 integration** sub-page (1 stray bullet off the web platform - `isWebAppPlatform()`).

Regression test `src/__tests__/components/settings/Tips.test.tsx` (3 cases). Swept the codebase for the same class: only `Dropdown.tsx` also uses `Children.map`, and it is SAFE (it returns non-elements unchanged and adds no per-child chrome); `BoxedList` draws its dividers with CSS `divide-y` on real DOM nodes, so a falsy child contributes nothing; no `{n.length && <JSX>}` numeric leaks exist anywhere in `src`.

Rule: a component that renders **per-child chrome** must use `Children.toArray`, never `Children.map`.
