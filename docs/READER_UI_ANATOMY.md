# Reader UI Anatomy

This document maps how the reader shell and left sidebar are actually composed in the Citadel reader UI. It is intended to help future UI passes target the real owning component and selector instead of guessing from screenshots.

## 1. Reader layout hierarchy

Top-level reader composition starts in `apps/readest-app/src/app/reader/components/ReaderContent.tsx`.

- `ReaderContent`
  - Owns the full reader screen shell: `div.reader-content.citadel-reader-shell.full-height.relative.flex`
  - Mounts the major chrome siblings:
    - `SideBar`
    - `BooksGrid`
    - `ReaderTopBar`
    - dialogs and overlays such as `SettingsDialog`, `Notebook`, `BookDetailModal`
  - Also owns a decorative absolute texture layer: `.citadel-reader-texture`

- `SideBar`
  - Owns the left rail, its open/collapsed states, resize affordance, and restore handle
  - It is a sibling of the reading surface, not nested inside `BooksGrid`

- `BooksGrid`
  - Owns the visible reading shell for each open book pane
  - Renders the physical book frame, page well, ornaments, per-book `HeaderBar`, and per-book `FooterBar`
  - This is the component that visually owns most of the page/spread area

- `ReaderTopBar`
  - Owns the global top-right controls above the reading area
  - Includes Library, Settings, Notebook, View menu, and window buttons

- `HeaderBar`
  - Per-book in-frame top chrome rendered inside `BooksGrid`
  - Owns library/back/title/quick actions inside the book frame area

- `FooterBar` / `DesktopFooterBar`
  - Per-book lower chrome rendered inside `BooksGrid`
  - Own the player tray, slider, navigation, and footer action buttons

Visible area ownership summary:

- left rail: `SideBar`
- page frame and spread surface: `BooksGrid`
- per-book top frame controls: `HeaderBar`
- per-book footer/player tray: `FooterBar` and `DesktopFooterBar`
- global top-right app controls: `ReaderTopBar`

## 2. Sidebar component hierarchy

Sidebar component tree, from outermost rail to interactions:

```text
ReaderContent
└─ SideBar
   ├─ collapsed state
   │  └─ button[data-testid="sidebar-restore-handle"]
   └─ open state
      └─ div.sidebar-container
         ├─ desktop resize handle
         ├─ mobile drag handle
         ├─ Header
         │  └─ div.sidebar-header
         │     └─ div.sidebar-brand-panel
         │        ├─ div.sidebar-brand-mark
         │        └─ div.sidebar-header-divider
         ├─ mobile search wrapper
         ├─ mobile BookCard wrapper
         └─ Content
            ├─ div.sidebar-content
            │  └─ active tab panel body
            └─ nav wrapper sibling
               └─ TabNavigation
                  └─ div.bottom-tab
                     ├─ button.citadel-rail-tab x 5
                     ├─ div.citadel-rail-spacer
                     └─ button.citadel-rail-collapse
```

Important relationship:

- `TabNavigation` does not directly sit inside `.sidebar-content`
- it sits inside a sibling wrapper rendered by `Content.tsx`
- that wrapper previously carried the hard seam under the header via `border-t` and background styling

## 3. Sidebar selector map

| Visual region                                  | Component / file    | Main selector / class                                                    | What it controls                                                                                                   | Known gotchas                                                                                                                                                                       |
| ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outer rail container                           | `SideBar.tsx`       | `.sidebar-container`                                                     | Desktop rail width, height, margin, radius, overall rail material, outer border, outer shadow                      | This is the true rail shell. Open-state desktop CSS lives in `style jsx` inside `SideBar.tsx`.                                                                                      |
| Inner rail decorative frame                    | `SideBar.tsx`       | `.sidebar-container` desktop CSS and internal rail styling               | The continuous charcoal/gold plate feel of the rail                                                                | Prior passes sometimes guessed at fake inner layers. Check `SideBar.tsx` first before adding new framing.                                                                           |
| Header/logo chamber                            | `Header.tsx`        | `.sidebar-header`                                                        | Header height, top padding, overall header block                                                                   | `sidebar-header::before` is disabled. If a seam appears below header, it may come from the next sibling, not this component.                                                        |
| Logo mark                                      | `Header.tsx`        | `.sidebar-brand-mark`                                                    | Logo sizing and visual placement                                                                                   | Logo size changes belong here, not in `SideBar.tsx`.                                                                                                                                |
| Logo divider                                   | `Header.tsx`        | `.sidebar-header-divider`                                                | Thin decorative line directly under the logo                                                                       | This was previously mistaken for the full-width white seam. It only controls the small centered logo divider.                                                                       |
| Sidebar content panel                          | `Content.tsx`       | `.sidebar-content`                                                       | Active tab panel region above the nav list                                                                         | Has its own decorative `::after` frame and `pointer-events: none`.                                                                                                                  |
| Nav wrapper sibling that caused the white seam | `Content.tsx`       | `div` immediately after `.sidebar-content`                               | Wraps `TabNavigation`; previously carried `border-t` and a separate background gradient that created the hard seam | This is the historical culprit for the header/nav seam, not the logo divider. In some passes it was overridden from `SideBar.tsx` with `.sidebar-container .sidebar-content + div`. |
| Nav root                                       | `TabNavigation.tsx` | `.bottom-tab`                                                            | Nav stack wrapper, bottom section padding, collapse row zone                                                       | It is not the full seam owner by itself; seam can come from the wrapper around it in `Content.tsx`.                                                                                 |
| Tab item                                       | `TabNavigation.tsx` | `.citadel-rail-tab`                                                      | Per-item height, icon/text alignment, inactive colors, hover state                                                 | All visible items are built from a tabs array in this file.                                                                                                                         |
| Active tab                                     | `TabNavigation.tsx` | `.citadel-rail-tab-active`                                               | Active wash, active text/icon colors, active accent container                                                      | Keep it from becoming a heavy “card” unless that is intentional.                                                                                                                    |
| Active left accent                             | `TabNavigation.tsx` | inner absolute accent div inside active tab                              | Thin red vertical indicator for selected item                                                                      | This accent is separate from the tab border/background.                                                                                                                             |
| Tab separator                                  | `TabNavigation.tsx` | `.bottom-tab .citadel-rail-tab + .citadel-rail-tab::before`              | Horizontal dividers between nav items                                                                              | This controls the separators between tabs, not the seam under the header.                                                                                                           |
| Collapse button                                | `TabNavigation.tsx` | `.citadel-rail-collapse`                                                 | Bottom collapse button styling and layout                                                                          | The button can exist in the DOM but still be visually unreadable if its contrast is too low.                                                                                        |
| Collapsed restore handle                       | `SideBar.tsx`       | `[data-testid="sidebar-restore-handle"]`, `.citadel-sidebar-restore-tab` | Left-edge restore handle when sidebar is collapsed                                                                 | This is the recoverability entry point. Do not remove without replacement.                                                                                                          |

## 4. Interaction map

Sidebar interactions are primarily wired through `useSidebarStore`, `useSidebar`, and `SidebarContent` state transitions.

- Active tab click
  - Defined in `TabNavigation.tsx`
  - Click handler calls the `onClick(tab)` prop from `Content.tsx`

- `Reading`
  - Tab key: `'reading'`
  - In `Content.tsx`, `handleTabChange('reading')`
  - Sets `activeTab` to `'reading'`
  - On mobile, clicking the same tab again can close the sidebar

- `Contents`
  - Tab key: `'toc'`
  - `handleTabChange('toc')`
  - Triggers fade transition, updates `targetTab`, and persists to `config.viewSettings.sideBarTab`

- `Notes`
  - Tab key: `'annotations'`
  - `handleTabChange('annotations')`
  - Same fade/persist flow

- `Bookmarks`
  - Tab key: `'bookmarks'`
  - `handleTabChange('bookmarks')`

- `Highlights`
  - Tab key: `'history'`
  - Label is rendered as `Highlights`
  - `handleTabChange('history')`

- Collapse button
  - In `TabNavigation.tsx`
  - `onClick={() => setSideBarVisible(false)}`
  - Open-state only

- Restore handle
  - In `SideBar.tsx`
  - `onClick={() => setSideBarVisible(true)}`
  - Collapsed-state only

Other sidebar-related wiring:

- `SideBar.tsx`
  - reads `sideBarVisible` from `useSidebarStore`
  - owns resize hooks via `usePanelResize`
  - owns dismiss behavior via `useSwipeToDismiss`

- `Content.tsx`
  - owns local tab fade state: `activeTab`, `targetTab`, `fade`
  - syncs with persisted `config.viewSettings.sideBarTab`

## 5. Layering / z-index / pointer-events map

Sidebar-specific layering:

- restore handle
  - `SideBar.tsx`
  - `.citadel-sidebar-restore-tab`
  - `z-[46]`
  - must remain above the page edge when collapsed

- open sidebar rail
  - `SideBar.tsx`
  - `.sidebar-container`
  - `z-10` on the outer rail wrapper

- resize handle
  - `SideBar.tsx`
  - absolutely positioned rail-edge interaction zone
  - interactive, so it must not be covered by decorative overlays

Decorative elements that must remain non-interactive:

- `ReaderContent.tsx`
  - `.citadel-reader-texture`
  - explicitly `pointer-events-none`

- `BooksGrid.tsx`
  - frame shells, aura, ornaments, corner pieces, footer/header seats, page well, spine
  - decorative layers are marked `pointer-events-none`

- `Content.tsx`
  - `.sidebar-content::after`
  - decorative frame wash, must stay `pointer-events: none`

General rule:

- decorative sidebar or reader-frame layers must never block:
  - page buttons
  - footer/player controls
  - sidebar tabs
  - collapse button
  - restore handle

Sidebar gotcha:

- a full-width seam can come from a real wrapper element between `Header` and `TabNavigation`, not from a pseudo-element
- when debugging visibility, verify the topmost element with hit-testing instead of assuming the visible line comes from the nearest divider

## 6. If you need to change X, edit Y

| If you need to change…                      | Edit this file                                                                                              | Main selector / code path                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Move logo                                   | `apps/readest-app/src/app/reader/components/sidebar/Header.tsx`                                             | `.sidebar-header`, `.sidebar-brand-panel`, `.sidebar-brand-mark`                                                          |
| Resize logo                                 | `apps/readest-app/src/app/reader/components/sidebar/Header.tsx`                                             | `.sidebar-brand-mark`                                                                                                     |
| Change rail width                           | `apps/readest-app/src/app/reader/components/sidebar/SideBar.tsx`                                            | `DESKTOP_SIDEBAR_WIDTH`, `.sidebar-container` desktop CSS                                                                 |
| Change rail material / background           | `apps/readest-app/src/app/reader/components/sidebar/SideBar.tsx`                                            | `.sidebar-container` desktop background, border, box-shadow                                                               |
| Change nav spacing                          | `apps/readest-app/src/app/reader/components/sidebar/TabNavigation.tsx`                                      | `.bottom-tab`, `.citadel-rail-tab`, `.citadel-rail-spacer`                                                                |
| Change active tab style                     | `apps/readest-app/src/app/reader/components/sidebar/TabNavigation.tsx`                                      | `.citadel-rail-tab-active` and active accent child                                                                        |
| Change separators between tabs              | `apps/readest-app/src/app/reader/components/sidebar/TabNavigation.tsx`                                      | `.bottom-tab .citadel-rail-tab + .citadel-rail-tab::before`                                                               |
| Change collapse button                      | `apps/readest-app/src/app/reader/components/sidebar/TabNavigation.tsx`                                      | `.citadel-rail-collapse`                                                                                                  |
| Change collapsed restore handle             | `apps/readest-app/src/app/reader/components/sidebar/SideBar.tsx`                                            | `[data-testid="sidebar-restore-handle"]`, `.citadel-sidebar-restore-tab`                                                  |
| Remove a seam / line between header and nav | `apps/readest-app/src/app/reader/components/sidebar/Content.tsx` first, then verify `SideBar.tsx` overrides | nav wrapper sibling after `.sidebar-content`; historically also overridden by `.sidebar-container .sidebar-content + div` |
| Add or remove nav item                      | `apps/readest-app/src/app/reader/components/sidebar/TabNavigation.tsx`                                      | tabs array and label/icon map                                                                                             |

## 7. Known failure history

- The white seam under the logo was not the small logo divider in `Header.tsx`.
  - The real culprit was the nav-wrapper sibling rendered by `Content.tsx`, which carried `border-t` and its own background.

- The collapse button existed in the DOM during earlier passes but was still effectively invisible.
  - The problem was contrast and paint, not missing wiring.
  - A button can be “present” in code while still failing visually.

- Agents must not claim visibility from code alone.
  - Screenshot and running-app verification matter.
  - If a control is not clearly visible in the rendered app, report that honestly.

- Sidebar fixes can be mis-targeted if you assume the nearest visible line belongs to the nearest divider.
  - Use deletion/isolation or hit-testing when a seam persists.

## 8. Verification checklist

Use this checklist for future sidebar passes:

- `Highlights` tab is visible
- `Bookmarks` label is plural
- collapse button is clearly visible
- collapse button actually collapses the rail
- restore handle appears when collapsed
- restore handle reopens the rail
- no top-right sidebar restore button exists
- no hard white seam exists between logo/header and nav
- nav items are clickable
- decorative layers use `pointer-events: none`
- `pnpm.cmd --filter @readest/readest-app lint` passes

Optional smoke harness checks worth keeping or adding:

- sidebar rail exists on `/reader`
- collapse button is hit-testable and clickable
- clicking collapse reveals restore handle
- clicking restore shows the rail again
- `Highlights` tab exists in the rendered nav
