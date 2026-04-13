## Adding a Config to `ViewSettings`

`ViewSettings` is the per-book view state (layout, fonts, colors, TTS, etc.) composed from several sub-interfaces defined in `src/types/book.ts`. A matching `globalViewSettings` lives on `SystemSettings` and acts as the default for every book. The per-book value is derived by merging the global defaults with any overrides stored on the book's `BookConfig`.

This doc covers how to plumb a new config through the three layers:

1. **Types** — `src/types/book.ts`
2. **Defaults** — `src/services/constants.ts` and `src/services/settingsService.ts`
3. **Read/write** — components via `saveViewSettings` from `src/helpers/settings.ts`

### Pick a Pattern

**Pattern A — add a field to an existing sub-interface.** Use when the new option belongs to an existing bundle (`BookLayout`, `BookStyle`, `BookFont`, `ViewConfig`, `TTSConfig`, etc.).

**Pattern B — introduce a new sub-interface.** Use when several related fields cluster together, or when a single field is semantically its own concept (e.g. `ParagraphModeConfig`, `ViewSettingsConfig`). Then extend `ViewSettings` with it.

Both patterns follow the same three-layer flow. The only difference is whether you reuse an existing `DEFAULT_*` constant or add a new one.

### Step 1 — Declare the Type

**Pattern A** — add a required field to the sub-interface that owns this concern:

```ts
// src/types/book.ts
export interface ViewConfig {
  // ...existing fields
  myNewToggle: boolean;
}
```

**Pattern B** — define a new interface and extend `ViewSettings`:

```ts
// src/types/book.ts
export interface ViewSettingsConfig {
  isGlobal: boolean;
}

export interface ViewSettings
  extends
    BookLayout,
    BookStyle,
    // ...other bundles
    ViewSettingsConfig {}
```

Fields should be **required**, not optional. Optional fields make downstream code defensive. Provide a sensible default in Step 2 instead.

### Step 2 — Provide a Default

Every field in `ViewSettings` must have a default, otherwise `getDefaultViewSettings()` produces an incomplete object.

**Pattern A** — add the value to the existing `DEFAULT_*` constant:

```ts
// src/services/constants.ts
export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  // ...existing defaults
  myNewToggle: false,
};
```

**Pattern B** — add a `DEFAULT_*_CONFIG` constant for your new bundle, then register it in `getDefaultViewSettings`:

```ts
// src/services/constants.ts
export const DEFAULT_VIEW_SETTINGS_CONFIG: ViewSettingsConfig = {
  isGlobal: true,
};
```

```ts
// src/services/settingsService.ts
export function getDefaultViewSettings(ctx: Context): ViewSettings {
  return {
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    // ...other bundles
    ...DEFAULT_VIEW_SETTINGS_CONFIG,
    // platform overrides go last so they win
    ...(ctx.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
    ...(ctx.isEink ? DEFAULT_EINK_VIEW_SETTINGS : {}),
    ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
  };
}
```

#### Platform Overrides

To tweak the default on mobile, e-ink, or CJK locales, add the field to the matching `Partial<ViewSettings>` constant (`DEFAULT_MOBILE_VIEW_SETTINGS`, `DEFAULT_EINK_VIEW_SETTINGS`, `DEFAULT_CJK_VIEW_SETTINGS`). These are spread after the base defaults in `getDefaultViewSettings`, so they override them.

#### Migration

Old `settings.json` files on disk won't have your new field. `loadSettings` merges the stored blob over fresh defaults:

```ts
settings.globalViewSettings = {
  ...getDefaultViewSettings(ctx),
  ...settings.globalViewSettings,
};
```

So existing users pick up your default automatically — no explicit migration is needed for adding a field. Only bump `SYSTEM_SETTINGS_VERSION` if you are reshaping existing data.

### Step 3 — Read and Write from Components

Read the current value by preferring the per-book settings, falling back to the global:

```tsx
const { settings } = useSettingsStore();
const { getViewSettings } = useReaderStore();
const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
```

Write via `saveViewSettings` — never mutate the store directly. The helper handles the global-vs-per-book routing, persists to disk, and re-applies styles when needed.

```tsx
import { saveViewSettings } from '@/helpers/settings';

const [myNewToggle, setMyNewToggle] = useState(viewSettings.myNewToggle);

useEffect(() => {
  saveViewSettings(envConfig, bookKey, 'myNewToggle', myNewToggle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [myNewToggle]);
```

The `useEffect`-on-local-state pattern is the established convention in `LayoutPanel`, `ControlPanel`, `ColorPanel`, etc. It keeps the UI responsive and batches store updates until the user stops interacting.

#### Signature

```ts
saveViewSettings<K extends keyof ViewSettings>(
  envConfig,
  bookKey,
  key: K,
  value: ViewSettings[K],
  skipGlobal = false,     // true → only update this book's settings
  applyStyles = true,     // false → don't re-run style recomputation
)
```

**Global vs. per-book routing.** `saveViewSettings` inspects `viewSettings.isGlobal` on the target book. When `true` (the default), it writes to `globalViewSettings`, loops through every open book, and saves to disk. When `false`, it writes only to the one book's config.

**Skip global.** Pass `skipGlobal=true` when the setting is meta — i.e. it describes the settings system itself, not book content. The canonical case is toggling `isGlobal` from `DialogMenu`: you want the scope flag to live on the specific book without propagating it to every other book.

```tsx
saveViewSettings(envConfig, bookKey, 'isGlobal', !isSettingsGlobal, true, false);
```

**Skip styles.** Pass `applyStyles=false` for options that don't affect CSS rendering (toggles, flags, metadata). This avoids an unnecessary `renderer.setStyles` call.

### Step 4 — Support Reset

If your field should be resettable from the panel menu, register a setter in the panel's `handleReset` via `useResetViewSettings`:

```tsx
const resetToDefaults = useResetViewSettings();

const handleReset = () => {
  resetToDefaults({
    myNewToggle: setMyNewToggle,
    // ...other setters
  });
};
```

The hook resolves the default by reading from `getDefaultViewSettings(ctx)` and calls each provided setter with that value, which then fires your `useEffect` and persists the change.

### Step 5 — Register in the Command Palette

If your setting has a visible row in a panel, register it in the matching `*PanelItems` array in `src/services/commandRegistry.ts`. This wires it into the command-palette fuzzy search so users can jump straight to it.

```ts
// src/services/commandRegistry.ts
const layoutPanelItems = [
  // ...existing entries
  {
    id: 'settings.layout.myNewToggle',
    labelKey: _('My New Toggle'),
    keywords: ['search', 'terms', 'for', 'discoverability'],
    section: 'Paragraph',
  },
];
```

- `id` must match the `data-setting-id` attribute on the panel row. The palette uses it to scroll/highlight the target control.
- `labelKey` uses `stubTranslation` (imported as `_`) so the extractor picks it up — the same string that appears in the panel.
- `keywords` broadens fuzzy-search hits beyond the label; include synonyms, related jargon, and the panel section name.
- `section` groups the entry in the palette results (matches the panel's sub-header: `Layout`, `Paragraph`, `Page`, `Header & Footer`, etc.).

Skip this step only for settings that don't surface as a user-visible row (hidden toggles, flags used by other settings).

### Don'ts

- **Don't make the field optional** just to skip providing a default. Add a default in Step 2 instead.
- **Don't mutate `settings.globalViewSettings` directly** in a component — `saveViewSettings` already handles global propagation when `isGlobal` is true.
- **Don't bump `SYSTEM_SETTINGS_VERSION`** for a plain additive field. The load-time merge handles it.

### Minimal Checklist

- [ ] Field or new interface added in `src/types/book.ts`
- [ ] Default value in `src/services/constants.ts`
- [ ] New `DEFAULT_*_CONFIG` spread into `getDefaultViewSettings` (Pattern B only)
- [ ] Optional mobile/eink/CJK override in the matching `Partial<ViewSettings>` constant
- [ ] Read via `getViewSettings(bookKey) || settings.globalViewSettings`
- [ ] Write via `saveViewSettings(envConfig, bookKey, 'key', value)`
- [ ] Reset setter wired into `useResetViewSettings` if the panel has a reset menu
- [ ] Command-palette entry added to the matching `*PanelItems` array in `src/services/commandRegistry.ts`, with an `id` that matches the panel row's `data-setting-id`
