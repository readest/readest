---
name: library-reader-separate-texture-4743
description: "Separate library vs reader background texture (#4743); shared-style-element + two gotchas"
metadata: 
  node_type: memory
  type: project
  originSessionId: dfdb7b38-1869-4fb4-b869-c32301c80128
---

#4743: library and reader shared one background texture; split so each is set independently.

**Architecture**: ONE global `<style id="background-texture">` paints `body::before` (covers library) plus reader containers (`.foliate-viewer/.sidebar-container/.notebook-container ::before`). Library and reader are separate routes (only one mounted), so the split = store two values + have each page apply its own on activation, not separate style elements. New device-local `SystemSettings.libraryBackground{TextureId,Opacity,Size}` (NOT in settings sync whitelist — texture *selection* is per-device like reader's `backgroundTextureId`; only image binaries sync via `texture` replica kind). `getLibraryViewSettings(settings)` in `helpers/settings.ts` resolves each field with `?? globalViewSettings.<field>` so the bookshelf inherits the reader texture until decoupled (no migration). `ColorPanel` is context-aware via `isLibraryContext = !bookKey`: library context writes `libraryBackground*` via `saveSysSettings`, reader context unchanged via `saveViewSettings`. Applied at boot (`Providers`) + on every library mount (`library/page.tsx` effect).
ThemePanel
**Gotcha 1 — `useBackgroundTexture` early-returned on `'none'` WITHOUT unmounting.** Since library+reader share the one style element, switching a page to None must actively clear a texture the OTHER page mounted. Fixed: always delegate to `applyTexture(envConfig, textureId || 'none')` (it unmounts on 'none'); only set CSS vars / addTexture for a real texture. Also fixes the symmetric reader case (opening a 'none' book after a textured one).

**Gotcha 2 — `useSettingsStore` initializes `settings: {} as SystemSettings`.** So `settings.globalViewSettings` is `undefined` on the first renders before `appService.loadSettings()` runs. Any NEW effect/deps that deep-derefs `settings.globalViewSettings.<x>` crashes the library with "Cannot read properties of undefined (reading 'backgroundTextureId')". Caught only in a hard reload (HMR kept old store state, so first nav didn't repro). Fix = optional-chain in effect deps + make the resolver tolerate missing globalViewSettings (fallback to 'none'). Relates to [[cover-stale-inplace-mutation-memo]].

Verified end-to-end in dev-web: library moon texture, reader stays none, round-trip persists, None clears live. Related: [[wordlens-feature]] i18n (recent feature commits ship `_()` strings WITHOUT running `i18n:extract`; translations are batched separately — don't commit locale churn in a feature PR).
