---
name: feedback-show-email-draft-before-sending
description: "When asked to reply to an email, show the draft in chat and wait for approval before clicking Send"
metadata:
  node_type: memory
  type: feedback
  originSessionId: c323c564-77a7-42ec-9fa7-1dcb71e9e49f
  modified: 2026-11-09T13:15:56.565Z
---

When the user says "Reply, <points>" for a Gmail thread, write the reply, show the draft in chat, and wait for an OK before sending. Don't send it straight away.

**Why:** On 2026-11-09 I sent a reply to a school's question about student data while the user was asking to "show me the draft first". It went out before they could review it, and they wanted the tone changed. The core message should have been that data is generally kept across sessions, with the disk-pressure case as the exception.

**How to apply:** Type the reply into the compose box (or show it in chat), stop, and send only after the user approves. Lead with the direct answer to the question asked, then give the caveats.
