# Platform Compatibility Fixes Reference

## Android

### WebView API Issues
- **`navigator.getGamepads()`** returns null on older WebView (#3245): Always null-check before `.some()`
- **`CompressionStream`** unavailable on some Android WebView versions (#3255): Add fallback zip compression path
- **Annotation tools unresponsive** (#3225): Don't call `makeSelection()` immediately on pointer-up; let popup flow complete naturally
- **Safe inset updates** (#3469): Call `onUpdateInsets()` after `setSystemUIVisibility()`
- **Navigation bar overlap** (#3466): Use `calc(env(safe-area-inset-bottom) + 16px)` for bottom padding

### General Android Rules
- Test with older WebView versions (97+)
- Always check API availability before calling Web APIs
- Touch event handling differs from iOS - avoid premature re-selection

## iOS

### Common Issues
- **Slider touch dead zones** (#3382): Strip native appearance, use larger hit areas (min-h-12)
- **Safe area insets stale** (#3395): Native Swift plugin must push updated insets
- **Section content caching** (#3242, #3206): Don't cache section content in foliate-js when updating subitems; cached content retains stale styles after mode switch
- **CompressionStream** (#3255): Also broken on iOS 15.x; zip.js has its own native API disable
- **zip.js native API** (#3170): Disable native `CompressionStream`/`DecompressionStream` on iOS 15.x

### iOS-Specific Code
- `src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift`
- Slider CSS: `-webkit-appearance: none; appearance: none` in globals.css
- `useSafeAreaInsets.ts` hook

## macOS

### Traffic Lights (Window Controls)
- Check `isFullscreen()` before hiding (#3129)
- Use timeouts (100ms) for visibility transitions (#3488)
- Don't hide when sidebar is open (#3488)

### Input Issues
- **Context menu steals event loop** (#3324): 100ms setTimeout before calling menu.popup()
- **Touchpad natural scrolling** (#3127): Respect system setting in `usePagination.ts`
- **Two-finger swipe** (#3127): Support trackpad two-finger swipe for pagination

### macOS-Specific Code
- `src-tauri/src/macos/` - Platform-specific Rust code
- `src/store/trafficLightStore.ts`
- `src/hooks/useTrafficLight.ts`

## Linux

### WebKitGTK Issues
- **View Transitions API unsupported** (#3417): Feature-detect `document.startViewTransition` before calling
- Use `useAppRouter.ts` to avoid transitions on Linux

## E-ink Devices

### Legibility Issues
- **Low contrast colors** (#3258): Use `not-eink:` Tailwind variant prefix for colors/opacity
- **Links invisible** (#3258): Don't apply `text-primary` (blue) on e-ink; use default text color
- **Opacity too low** (#3258): Don't apply `opacity-60`/`opacity-75` on e-ink devices
- **Highlight visibility** (#3299): Use foreground color for highlights in dark mode e-ink

### E-ink CSS Pattern
```
// Instead of:
className="text-primary opacity-60"
// Use:
className="not-eink:text-primary not-eink:opacity-60"
```

## Docker/Self-Hosting
- **Missing submodules** (#3233): Run `git submodule update --init --recursive` before build
- Simplecc WASM module must be initialized

## OPDS
- **Non-ASCII credentials** (#3436): Use `TextEncoder` + manual Base64 instead of `btoa()`
- **Author parsing** (#3120): Handle varied metadata structures in OPDS 2.0 feeds
- **Responsive layout** (#3418): Ensure catalog and download button layout works on small screens

## Cross-Platform Testing Checklist
1. Android (old WebView + current)
2. iOS (15.x + current)
3. macOS (traffic lights, trackpad)
4. Linux (WebKitGTK)
5. E-ink devices (contrast, colors)
6. Web (CloudFlare Workers deployment)
