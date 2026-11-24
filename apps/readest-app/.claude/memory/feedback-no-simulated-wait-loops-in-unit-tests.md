---
name: feedback-no-simulated-wait-loops-in-unit-tests
description: never write elapse(12_000)-style simulated-time loops or real-route harnesses in unit tests; they slow the pre-push hook and CI
metadata:
  type: feedback
---

Never write `await elapse(12_000)`, a helper stepping fake timers through many `act()` calls, in a unit test. chrox removed
two such harnesses from PR #7326 (`useNotesSync-route`, `useNotesSync-real-sync`) because they slow the pre-push hook and CI.

**Why:** the unit suite runs on every push, so its cost is paid constantly, even when one file looks cheap.
**How to apply:** test one behavior with mocked `useSync` and a direct assertion. Use a throwaway harness in the scratchpad for
timing or loop reproductions, and don't commit it. Server rules go through a direct `POST` test with no timers.
