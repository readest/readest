---
name: architecture-notes
description: Quick architecture pointers (foliate-js submodule, style pipeline, TTS index, insets, dropdowns)
metadata:
  type: reference
---

- foliate-js submodule `packages/foliate-js/`; multiview paginator preloads adjacent sections
- Style: `getLayoutStyles()` always, `getColorStyles()` when overriding; `transformStylesheet()` rewrites EPUB CSS
- TTS `#ttsSectionIndex`; insets: native plugin → useSafeAreaInsets → styles; Dropdowns `DropdownContext`
