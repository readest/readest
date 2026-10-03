---
name: bookdrop-own-section-6360
description: "#6360 Nearby BookDrop (default-on LAN listener) moved into its own \"Local Network\" section at the top of Integrations; MERGED #6499 (d4f331261) UNRELEASED"
metadata:
  node_type: memory
  type: project
  originSessionId: afdf8c4a-cbf1-469b-9dd1-a130ddf4c2f7
  modified: 2026-09-30T11:43:45.718Z
---

Issue #6360: a user found Readest listening on 0.0.0.0:53318 and had to hunt for the cause, Nearby BookDrop, which sat last under Content Sources. PR #6499 (merged 2026-09-30 as d4f331261) adds a "Local Network" section that leads the panel. The row shows "Visible as {{name}}" and has an inline checkbox (it reuses `CloudProviderRow`). The panel listens to `localsend-prefs-changed` so it stays in sync with the sub-page toggle.

**Why:** chrox first proposed an "enabled integrations" section. It was rejected because the Cloud Sync rows toggle inline, so rows would jump sections under the pointer, and "enabled" has no clear meaning for OPDS, ABS or Send to Readest. chrox agreed to the dedicated fixed section instead.

**How to apply:** if integrations get grouped by state again, don't move rows based on state. Keep default-on or network-exposing features in a fixed, prominent place. Verified visually only via a vitest browser render (light/dark/e-ink) with a throwaway config setting NEXT_PUBLIC_APP_PLATFORM=tauri; must run with http_proxy unset or the browser run hangs.
