---
name: minified-stack-module-namespace-frames
description: "A minified `Module.<letter>` stack frame means an ESM namespace import; in Readest that narrows to foliate-js epubcfi, which pinpoints crashes without sourcemaps"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 8ab58725-3ddd-4ae4-9fcd-de424cd4f0b3
  modified: 2026-08-06T06:19:48.415Z
---

A production stack frame shaped `at Module.y (chunks/9047-<hash>.js:1:9934)` is not
anonymous noise — `Module` is V8 printing the receiver's `Symbol.toStringTag`, which
webpack stamps onto **ESM namespace objects**. So `Module.<something>` means the call
site was `ns.fn(...)` on a `import * as ns` namespace, not a destructured named import
(those compile to `(0, r.a)(...)` and lose the receiver, printing a bare `a`).

That single fact is a powerful filter when you have no sourcemap. In readest-app the
whole set of namespace imports is tiny:

```
grep -rn "import \* as" src --include='*.ts' --include='*.tsx'
```

Only `foliate-js/epubcfi.js` (as `CFI` / `epubcfi`, plus `export const CFI = epubcfi`
in `src/libs/document.ts`) and `foliate-js/progress.js` qualify. `progress.js` exports
only classes, whose frames would read `ClassName.method`. So a `Module.<x>` frame in a
Readest crash is almost always an **epubcfi export**, and the property being
dereferenced in the error message identifies which one:

- `reading 'start'` -> `CFI.compare` (`epubcfi.js:166`, `if (a.start || b.start)`)
- `reading 'parent'` -> `CFI.collapse`

Two more forensic notes that saved time:

- **`null` vs `undefined` in the message is load-bearing.** "Cannot read properties of
  **null**" means a literal `null` reached the call — which in this codebase points at
  data round-tripped through **cloud sync**, where a SQL NULL column serializes to JSON
  `null` (TypeScript's `cfi: string` is not enforced at runtime). `undefined` instead
  points at a missing array slot or dropped object key.
- **Both frames in the same chunk is a real constraint.** It tells you the caller module
  and the callee module got bundled together, which eliminates call sites living in
  route/page chunks (React components) and points at co-located shared utils.

Verify the reconstruction by writing the failing unit test and reading vitest's
unminified stack — if it prints `Module.compare` over your suspected caller, the
minified frames map 1:1 and you have the right site. See
[[cfi-compare-null-crash-findnearestcfi]].

Two dead ends, so you can skip them: readest webpack chunk hashes are content-derived
and the deployed site no longer serves old ones (`curl` returns 404/500), and
`.open-next/assets/_next/static/chunks/` from a *local* build has different chunk IDs
and byte offsets than the user's build, so offsets do not transfer. Chunk *composition*
still tells you which modules bundle together, which is the part worth checking.
