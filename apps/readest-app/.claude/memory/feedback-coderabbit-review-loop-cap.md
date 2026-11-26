---
name: feedback-coderabbit-review-loop-cap
description: "On a big PR, CodeRabbit's full re-review keeps finding new Minor items each pass; the owner capped it at one fix round per pass, then only Major/Critical findings get code"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 501a9ec1-5fb6-45a8-912a-e2c21ace66c7
  modified: 2026-11-25T18:55:21.073Z
---

On #7930 (gift cards, about 40 commits), each push got a full CodeRabbit re-review: 22 findings, then 16, then 14. Every pass surfaced new Minor items in code it had already passed. When asked how to proceed after the third pass, the owner chose: "One more round, then stop".

The agreed handling:
- **That last round:** fix the cheap real findings test-first, decline sub-second races with the reason, and answer every thread.
- **After that, only Major or Critical findings get code.** Minor ones get a brief reply: fixed, or why not.

**Why:** a full re-review of a large PR never converges. Each round costs a verify pass, a push and the full pre-push suite, and adds surface for the next round, while the findings shrink to edge cases.

**How to apply:**
- On a large PR's second or later CodeRabbit pass, triage by severity first.
- If the findings are all Minor, ask the owner before starting another full round, or follow this cap if they already set it for that PR.
- Every thread still gets an answer before merge (see the acceptance rules). Related: [[feedback-pr-watch-fix-conflicts]], [[feedback-pr-review-trust-policy]].
