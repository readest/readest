---
name: zip-alerts-blocked-on-tauri-fork-2-12
description: "Dependabot zip crate alerts (#411/#416/#417) come only from tauri-plugin-updater 2.11.0 (Windows, zip ^4); fixing them needs updater 2.14.1, which needs tauri >= 2.12 — the readest fork is 2.11.5"
metadata:
  node_type: memory
  type: project
  originSessionId: e17eef75-680a-4f9b-bdbf-e1ea848da140
  modified: 2026-11-17T08:05:53.213Z
---

As of 2026-11-17, three Rust Dependabot alerts on readest/readest stay open: zip 4.6.1 (GHSA-m665-v7pm-7grj critical, GHSA-q7v9-x93c-xqv3 high, GHSA-8hxf-qr8p-62x4 medium). zip 4.6.1 is pulled only by `tauri-plugin-updater` 2.11.0 under `cfg(target_os = "windows")`. Updater 2.12.0–2.14.0 still require zip ^4; 2.14.1 moves to zip ^9 but requires `tauri ^2.12`, and the readest tauri fork (`packages/tauri`, via `[patch.crates-io]`) is 2.11.5.

**Why:** a plain `cargo update -p tauri-plugin-updater` cannot clear them; the updater only unpacks a payload after its minisign signature verifies, so exposure is low. The npm alerts from the same sweep (next, react-server-dom-webpack, fast-xml-parser) were fixed in #7583 (f3ea1fcc6).

**How to apply:** clear these alerts as part of the next tauri fork bump to >= 2.12 (bump updater to 2.14.1+ in the same PR, regenerate Cargo.cef.lock and cargoHash per [[nix-fod-hash-staleness]]). The owner had not chosen fork bump vs dismissal when this was written.
