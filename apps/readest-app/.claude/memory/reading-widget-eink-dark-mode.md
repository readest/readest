---
name: reading-widget-eink-dark-mode
description: Android Reading widget showed black text on a dark card when Readest E-ink mode + system dark mode; fix = theme-attr ink color resolved by the launcher
metadata:
  node_type: memory
  type: project
  originSessionId: 2f0e045c-3c03-4b47-ab38-3bba3c2670aa
  modified: 2026-10-04T15:35:46.470Z
---

Found 2026-10-04 on the Xiaomi (0.12.10, regression from #6518): E-ink mode in `ReadingWidgetProvider` forced `Color.BLACK` text + a `#000000` progress fill, while the card background (`?android:attr/colorBackground` under the values/values-night `BookshelfWidgetTheme`) followed system dark mode -> black on dark grey.

**Fix (PR #6628 MERGED as d1a7a0435, UNRELEASED; Xiaomi now runs this branch's release build):** `res/color/widget_eink_ink.xml` = `?android:attr/colorForeground` (black light / white night); E-ink progress fill uses the same attr; text set via `RemoteViews.setColorStateList(id, "setTextColor", R.color.widget_eink_ink)` on API 31+ (launcher resolves it at apply time, so a system dark-mode flip repaints with NO republish, Xiaomi-VERIFIED), fallback `setTextColor(themed.getColor(...))` below 31 (stale until next republish). View building moved to `ReadingWidgetProvider.buildViews` for the instrumented test `ReadingWidgetEinkThemeTest`.

**Traps hit:**
- The tell for the E-ink branch on a screenshot is the black/white (not teal) progress fill.
- `data-eink` on the library page is null even with E-ink on; read `globalViewSettings.isEink` from settings.json (`plugin:fs|read_text_file`, baseDir 14) over CDP instead.
- `BookshelfWidgetConfigureActivityTest` hangs on MIUI from the launcher (activity start blocked); run other classes by name.
- Killing a hung `connectedAndroidTest` leaves the gradle daemon to uninstall the test APK mid next run ("Process crashed").
- Two emulators at once crashed Android_17; Android15_API35 AVD has no system image; usable AVDs: `Android_17` (API 37), `Android9_API28`. SDK is `/Users/chrox/dev/Android/sdk`.
- Local keystore cert == installed release cert, so `pnpm dev-android` installs over a store build keeping data. Set `screen_off_timeout` high during the ~5 min build or MIUI locks and refuses installs.
- A throwaway androidTest that `RemoteViews.apply` + `view.draw` to a PNG gives a real widget render without a launcher.
