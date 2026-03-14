## Build Constraints

- No optional chaining (`?.`) in build output — verified by `check:optional-chaining`.
- No lookbehind regex in build output — verified by `check:lookbehind-regex`.
- Run `pnpm build-check` (builds both targets + runs all checks) before submitting.
