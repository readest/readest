---
name: No test seams in production code
description: Never import or call `__reset*ForTests` (or any test-only helper) from production modules — keep test orchestration on the test side
type: feedback
originSessionId: 49a72b36-8f45-4a57-87e1-e10563bac47a
---
Production code must never import or call functions named `__reset*ForTests`
(or any other test-only seam). If a `__resetXForTests` function in module A
needs to also clear state owned by module B, the test file is responsible
for calling both resets — not module A's reset chaining into module B's.

**Why:** Importing a test-only helper into a production module pulls the
test seam into the prod import graph, blurs the test/prod boundary, and
risks the helper being shipped or mistakenly called at runtime. Caught
once in `src/services/sync/replicaSync.ts` where
`__resetReplicaSyncForTests` had been changed to call
`__resetSettledEventsForTests` from `@/utils/event` for "convenience."

**How to apply:**
- A `__resetXForTests` function should clear ONLY its own module's state.
- If a test needs a coordinated reset across modules, do it in the test
  file's `beforeEach` / `afterEach` — call each module's seam directly.
- Never `import { __reset...ForTests }` inside `src/` outside of
  `src/__tests__/`. A grep `grep -rn "__reset.*ForTests" src/ --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v "^.*export const __reset"` should return zero hits.
