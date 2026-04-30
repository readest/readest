---
name: No lookbehind regex
description: Never use lookbehind assertions in JS/TS code — the build check rejects them for browser compatibility
type: feedback
---

Never use lookbehind regex (`(?<=...)` or `(?<!...)`) in JavaScript/TypeScript source code. Use `(?:^|[^...])` or other alternatives instead.

**Why:** The project has a `check:lookbehind-regex` build check (`pnpm check:all`) that scans the Next.js output chunks and fails if any lookbehind assertions are found. Older WebViews (especially on some Android devices) don't support lookbehinds.

**How to apply:** When writing regex that needs to assert what comes before a match, use a non-capturing group with alternation (e.g., `(?:^|[^a-z-])`) instead of a negative lookbehind (`(?<![a-z-])`). This applies to all `.ts`/`.tsx`/`.js` files that end up in the build output.
