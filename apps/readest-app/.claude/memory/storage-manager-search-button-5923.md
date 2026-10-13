---
name: storage-manager-search-button-5923
description: "#5923 cloud Manage Storage search auto-fired on a 1s debounce and disabled its own input; fix = explicit Search button + IME guard"
metadata:
  type: project
---

`#5923` (2026-08-28): the cloud **Manage Storage** file search (`src/app/user/components/StorageManager.tsx`)
searched 1s after the last keystroke and set `disabled={loading}` **on the search input itself**.
Two separate defects for CJK/IME users:

1. the debounce fired mid-composition, so the pending request landed while the IME
   candidate window was open;
2. the in-flight request then **disabled the box the user was typing into**, dropping focus
   and the composition with it.

Fix: MERGED #5925 (squash 0fcbd16f7, 2026-08-28); branch deleted local+remote.
- dropped the `debounce(…, 1000)` + `useEffect` pair for a `submitSearch()` called from a
  `<form onSubmit>`; input is `type='search'` (mobile keyboards get a Search key), button is
  `btn btn-contrast` per the e-ink rules.
- the input is **never** disabled any more — `loading` only disables the submit button.
- `onKeyDown` guards `e.key === 'Enter' && e.nativeEvent.isComposing` with `preventDefault()`
  so committing an IME candidate can't trigger the form's implicit submission.

**Why:** an auto-search that also locks its own input is unusable with any composition-based
input method, and no other search in the app does this — `HardcoverLinkDialog` already uses
the form+button idiom that this now matches.

**How to apply:**
- jsdom does **not** implement implicit form submission, so an Enter-key test can only assert
  `defaultPrevented` (via `createEvent.keyDown`); drive the real search through the button.
- `@testing-library/react` auto-cleanup is OFF here (vitest `globals` is not set) — component
  tests must `afterEach(cleanup)` or the next `getBy*` finds duplicates.
- Mock `useTranslation` to return a **stable** function. The real hook memoizes with
  `useCallback`; a fresh arrow per render re-creates `loadFiles` and re-fires its effect,
  so the mount fetch counts go non-deterministic.
- `en/translation.json` holds only overrides (key-as-content), so a missing `"Search"` there
  is correct, not a gap. See [[reader-feature-fixes]].
