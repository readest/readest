# Readest AI Coding Agent Instructions

## Project Overview
Readest is an open-source ebook reader built with Next.js 16 and Tauri v2, targeting macOS, Windows, Linux, Android, iOS, and Web platforms. It supports multiple formats (EPUB, MOBI, AZW3, FB2, CBZ, PDF) with features like annotations, full-text search, dictionary lookup, and cross-platform sync.

## Architecture

### Multi-Platform Architecture
- **Tauri v2**: Desktop/mobile native apps using system webviews
- **Next.js 16**: Web app with static exports
- **Single codebase**: Shared React components with platform abstraction via `EnvContext`

### Platform Abstraction Layer
- `AppService` interface abstracts platform-specific functionality
- `NativeAppService` (Tauri) vs `WebAppService` (browser) implementations
- Environment detection via `NEXT_PUBLIC_APP_PLATFORM` (tauri/web)
- Use `useEnv()` hook to access `appService` and `envConfig`

### State Management
- **Zustand stores**: Located in `/src/store/` (settings, theme, library, reader, etc.)
- **React Context**: Authentication, environment, dropdowns, command palette
- **Global providers**: Set up in `/src/components/Providers.tsx`

### File System Abstraction
- `FileSystem` interface handles platform-specific file operations
- `BaseDir` enum defines logical directories (Books, Settings, Data, Fonts, Images)
- IndexedDB for web, Tauri FS plugin for native platforms

## Key Development Patterns

### Component Structure
- Pages in `/src/app/` (library, reader, auth, etc.)
- Reusable components in `/src/components/`
- Hooks in `/src/hooks/` for platform-specific logic
- Services in `/src/services/` for business logic

### Internationalization
- Powered by i18next with files in `/public/locales/`
- Use `useTranslation` hook for translations
- Extract strings with `pnpm i18n:extract`

### Book Handling
- Books represented by `Book` type in `/src/types/book.ts`
- Book metadata extraction via `foliate-js` library
- Book content loading through `loadBookContent()` method

## Critical Developer Workflows

### Development Commands
```bash
# Native app development
pnpm tauri dev

# Web app development  
pnpm dev-web

# Install vendor dependencies (after cloning/updates)
pnpm --filter @readest/readest-app setup-vendors

# Production builds
pnpm tauri build                    # Native
pnpm tauri build --target [platform] # Specific platform
pnpm build-web                      # Web
```

### Platform-Specific Development
- **Mobile**: Use `pnpm tauri android dev` or `pnpm tauri ios dev`
- **Web**: Set `NEXT_PUBLIC_APP_PLATFORM=web` for web-specific behavior
- **Native**: Set `NEXT_PUBLIC_APP_PLATFORM=tauri` for native features

### Testing and Validation
- Run `pnpm build` to validate both web and native builds
- Use `pnpm tauri info` to verify Tauri dependencies
- Web bundle analysis: `ANALYZE=true pnpm build-web`

## Project-Specific Conventions

### File Operations
- Always use `appService` methods for file operations, not direct FS calls
- Use `BaseDir` enum for logical directories instead of hardcoded paths
- Handle both local and cloud book storage via `uploadBook`/`downloadBook` methods

### UI Components
- Use DaisyUI for consistent styling
- Apply responsive design with `useResponsiveSize` hook
- Follow accessibility patterns for screen readers

### Feature Flags
- Platform-specific features guarded by `appService` properties
- Check `appService.hasFeature` before using platform-specific APIs
- Use `isTauriAppPlatform()`/`isWebAppPlatform()` for rendering differences

## Integration Points

### External APIs
- Supabase for authentication and sync
- DeepL/Yandex for translation
- Stripe for in-app purchases
- Various cloud storage providers

### Native Plugins
- Tauri plugins in `/src-tauri/plugins/` for system integration
- Custom plugins like `tauri-plugin-native-tts` and `tauri-plugin-sharekit-api`
- Access via `@tauri-apps/api` and `@tauri-apps/plugin-*` packages

### Vendor Libraries
- `foliate-js` for ebook parsing and rendering
- `pdfjs-dist` for PDF support (located in public/vendor/)
- `simplecc-wasm` for CJK font support

## Common Tasks

### Adding New Features
1. Implement in both `NativeAppService` and `WebAppService` if platform-specific
2. Add to `AppService` interface in `/src/types/system.ts`
3. Use feature detection rather than platform detection when possible
4. Update stores in `/src/store/` if state management needed

### Working with Books
- Use `importBook()` for adding books to library
- Leverage `loadBookContent()` for reading
- Handle sync via `SyncProvider` context
- Respect `DeleteAction` enum for deletion options (cloud/local/both)

### Environment Variables
- Web: `.env.web`, Native: `.env.tauri`
- Platform detection: `NEXT_PUBLIC_APP_PLATFORM`
- API endpoints: `NEXT_PUBLIC_API_BASE_URL`

## Important Files
- `/src/services/environment.ts` - Platform abstraction layer
- `/src/types/system.ts` - Core interfaces and types
- `/src/components/Providers.tsx` - Global context providers
- `/src/store/` - Zustand stores for state management
- `/src/app/library/page.tsx` - Main application entry point
- `/src/services/nativeAppService.ts` & `/src/services/webAppService.ts` - Platform implementations