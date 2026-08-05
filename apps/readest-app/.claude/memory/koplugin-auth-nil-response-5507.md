---
name: koplugin-auth-nil-response-5507
description: "PR #5507 koplugin login crash - Lua string indexing hides the nil, all six Supabase endpoints shared the defect, and how to unit-test SupabaseAuthClient/SyncAuth under busted"
metadata: 
  node_type: memory
  type: project
  originSessionId: a002d9e7-7161-4d69-87ec-96bb541c5d5c
  modified: 2026-08-05T07:11:36.442Z
---

PR #5507 (jemyzhang): KOReader crashed on login when the network request
failed. Reviewed 2026-08-05, pushed a follow-up commit `440f70621`, all CI green.
MERGED 2026-08-05 as `6e4867c86`.

**The silent nil.** In `readest_supabaseauth.lua` every endpoint does
`local ok, res = pcall(...)`; on failure `res` is the error *string*. Indexing a
string with `.body` does NOT raise in Lua - the string metatable sends the lookup
to the `string` table and yields `nil`. So `return false, res.body` degraded to
`false, nil`, and `SyncAuth:doLogin` then died on `response.msg` with
`attempt to index local 'response' (a nil value)`. Watch for this any time Lua
code reads a field off a pcall error value.

**The defect was in all six endpoints, not two.** The original PR fixed
`sign_in_password` + `verify_otp`. `sign_in_otp`, `refresh_token`, `sign_out`,
`get_user` had the identical block. `refresh_token` is the live one
(`tryRefreshToken`, `withFreshToken`) - it did not crash because both callers
guard, but it logged `"Unknown error"` and swallowed the real cause. Fix shipped
as a single `unwrap(name, expected_status, ok, res)` helper: net -17 lines vs the
original +3, and the contract "second return value is always a table" now holds
by construction. `callback(unwrap(...))` forwards both values through.

**`sign_in_otp` / `verify_otp` are dead code.** They are absent from
`supabase-auth-api.json`, and Spore only generates client methods from the spec,
so `self.client:verify_otp(...)` is nil and always takes the failure branch.
No callers anywhere. Dead since #4153 (`git log -S`). Deleting them (~48 lines)
is still an open follow-up.

**Testing the auth layer under busted** (`spec/syncauth_spec.lua`, 6 tests):
- Preload a fake `Spore` (`new_from_spec` returns your stub client) and a fake
  `socketutil`. Give the stub client no-op `reset_middlewares`/`enable`, which
  keeps the AsyncHTTP middleware inert, so `coroutine.resume(co)` runs the
  callback synchronously - async endpoints test like sync ones.
- `init()` does `package.loaded["Spore.Middleware.X"] = {}` then `require`s it,
  so no real Spore middleware is needed.
- Busted runs every spec file in ONE Lua state and `package.preload` is global;
  `syncstats_spec` / `syncannotations_spec` register competing stubs for
  `ui/uimanager`, `ui/widget/infomessage`, `ffi/util`. Do NOT assume which won -
  patch fields on the table `require` returns (`UIManager.show`,
  `InfoMessage.new`) in before_each and restore in after_each.
- EXCEPTION: values captured into module upvalues at load time cannot be patched
  afterwards. `readest_syncauth` does `local T = require("ffi/util").template`,
  so a substituting `template` must be installed BEFORE `require("readest_syncauth")`,
  at spec-file scope. Same trap for any `local X = require(...).field` pattern.
- `spec_helper`'s `Device` fake needed `setIgnoreInput` added (`doLogin` and
  `readest_selfupdate` call it).

Delivered with the fast-forward-onto-fork-tip recipe in
[[ci-pr-delivery-and-push]] - no rewrite, author's SHA `ccbc92f85` intact.
See also [[koplugin-cover-upload]], [[feedback-no-mock-only-platform-tests]].
