---
name: bg-texture-scope-switcher-5306
description: "#5306 Background Image Library|Reader scope switcher in Settings-Theme; page-resolved live preview rule"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9ebc4597-e051-4942-906c-7ff10679c855
  modified: 2026-08-02T14:27:10.234Z
---

#5306: users never noticed the Background Image picker was context-scoped (title suffix "(Library)/(Reader)" from [[library-reader-separate-texture-4743]] was the only signal). Fix MERGED #5443 (squash 47cd7b4, 2026-08-02; worktree and branch cleaned up, spec+plan archived in main repo `.claude/plans/`): a `Library | Reader` text segmented control in the section header, defaulting to the opened-from page; either scope editable from anywhere. Maintainer explicitly rejected Zed/VS Code-style scope editors; Apple-simple only (iOS Wallpaper Lock/Home pair is the precedent).

Key mechanics:
- `getBackgroundTextureSettings(scope, settings, readerViewSettings?)` in `helpers/settings.ts` resolves per scope; reader scope from library context = `globalViewSettings` (and `saveViewSettings` with empty bookKey already writes globals — no new plumbing).
- Live preview rule: after any edit, re-apply the CURRENT page's resolved texture (`getLibraryViewSettings` on library; local state on reader), never the edited scope's values. Editing the other scope repaints nothing; when the library still inherits, reader edits follow through live — truthful per-field `??` fallback.
- Scope switch re-seeds the three local states; the save effects' equality guards prevent spurious writes; bypassing `handleTextureSelect` keeps atmosphere activation click-only.
- Segmented control copies ThemeModeSelector anatomy exactly (h-9 44px targets #4831, `eink-bordered` track + `eink-inverted` thumb); text labels `_('Library')`/`_('Reader')` (`Reader` is a NEW i18n key, untranslated on purpose).
- commandRegistry `settings.color.backgroundTexture` gained `library`/`reader` keywords.

Verified in dev-web via Chrome MCP: default scopes per page, decouple, inheritance live-follow, cross-page persistence, eink zoom, settings search.
