---
name: character-tracking-direction
description: "Maintainer's direction for character/dialogue tracking features — build on global annotations + notebook, not a separate system"
metadata:
  node_type: memory
  type: project
  originSessionId: 32529c07-b927-4154-92d2-831af97f781d
  modified: 2026-10-10T02:30:59.329Z
---

Maintainer (chrox) closed community PR #6690 (2026-10-10), a standalone character system: its own BookConfig `characters` field, an overlay path, image data URLs, and new toolbar/header buttons. The preferred direction: a **character = a global annotation** on the name (highlights every occurrence; its note holds the description), and **dialogue = notes in the notebook**.

**Why:** reuses the existing booknote sync, export, and tap handling, with no new data model. #6690 also hijacked taps on names, bloated config.json with images, never synced, and added default toolbar/header buttons for a niche feature.

**How to apply:** when a PR or feature request asks for character tracking, a cast list, or speaker attribution, steer it toward extending global annotations and the notebook (e.g. a character-list view over global annotations), and keep it opt-in.
