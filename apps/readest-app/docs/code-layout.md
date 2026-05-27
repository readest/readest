# Readest App Code Layout

This note summarizes the runtime boundaries inside `apps/readest-app`, with two goals:

- explain which directories are server-side, client-side, or mixed
- explain the directory-level role of `apps/readest-app/src/services`

## First: `src-tauri` 

`apps/readest-app/src-tauri` is the Tauri native shell layer for all Tauri targets, not just desktop.

- Desktop: Windows, macOS, Linux
- Mobile: Android, iOS

That is visible in `apps/readest-app/src-tauri/tauri.conf.json`, which contains both `bundle.android` and `bundle.iOS` configuration, plus mobile deep-link settings.

So the rough split is:

- `apps/readest-app/src`: the Next.js/React app
- `apps/readest-app/src-tauri`: the native host layer for Tauri desktop and mobile builds

## Directory classification inside `apps/readest-app`

### Mostly server-side directories

- `apps/readest-app/src/app/api`
  Next.js App Router server endpoints (`route.ts`). These run on the server / edge runtime, not in the browser.

- `apps/readest-app/src/pages/api`
  Next.js Pages Router API endpoints. This is where the classic server handlers live, including sync, storage, send, DeepL, and user endpoints.

- `apps/readest-app/src/app/runtime-config.js`
  A server route that emits runtime JavaScript config for the client.

- `apps/readest-app/workers`
  Worker-side backend code outside the normal page UI tree. For example, `workers/send-email` is operational backend code.

### Mostly client-side directories

- `apps/readest-app/src/components`
  Reusable React UI components.

- `apps/readest-app/src/context`
  React context providers and app state wiring.

- `apps/readest-app/src/hooks`
  Client-side React hooks.

- `apps/readest-app/src/store`
  Frontend state stores.

- `apps/readest-app/src/styles`
  Styling, theme assets, and UI presentation helpers.

- `apps/readest-app/src/data`
  Static or bundled app data.

- `apps/readest-app/src/i18n`
  Internationalization resources and setup.

- `apps/readest-app/src/workers`
  Browser worker code used by the frontend.

- `apps/readest-app/public`
  Static assets served to the frontend.

- `apps/readest-app/extension`
  Browser-extension-specific client code.

- `apps/readest-app/extensions`
  Platform integration extensions such as Windows thumbnail support.

### Mixed or shared directories

- `apps/readest-app/src/app`
  Mostly frontend routes and UI, but not purely client-side. In Next App Router, `page.tsx`, `layout.tsx`, and related files can mix server rendering and client components. The exception is `src/app/api`, which is server-only.

- `apps/readest-app/src/pages`
  Mixed. `src/pages/api` is server-only; `src/pages/reader/[ids].tsx` is frontend page code; `_document.tsx` is server-side document wiring.

- `apps/readest-app/src/services`
  Shared domain/service layer. Most of this is not “backend-only”; it contains platform adapters, client logic, network clients, sync logic, and some code that is reused by server routes.

- `apps/readest-app/src/utils`
  Shared helpers used by both frontend code and server handlers.

- `apps/readest-app/src/libs`
  Shared library code. Some of it is server-oriented, some client-oriented, some neutral.

- `apps/readest-app/src/helpers`
  General helper code, usually shared.

- `apps/readest-app/src/types`
  Shared type definitions.

- `apps/readest-app/src/__tests__`
  Test code covering both client and server behavior.

- `apps/readest-app/e2e`
  End-to-end test suite.

- `apps/readest-app/scripts`
  Build, release, and maintenance scripts.

- `apps/readest-app/docs`
  App-specific documentation.


## `src/app` and `src/pages` at directory level

### `src/app`

- `src/app/api`: server-side HTTP endpoints
- `src/app/auth`: auth pages and auth-related UI/helpers
- `src/app/library`: library UI
- `src/app/o`: frontend route
- `src/app/offline`: frontend offline page
- `src/app/opds`: OPDS browsing UI
- `src/app/reader`: reader UI
- `src/app/runtime-config.js`: server-generated runtime config endpoint
- `src/app/s`: share landing UI
- `src/app/send`: send/import UI
- `src/app/updater`: updater UI
- `src/app/user`: account/subscription/settings UI

So `src/app` is mostly application UI, with one explicitly server-only subtree: `src/app/api`, plus the runtime-config route.

### `src/pages`

- `src/pages/api`: server-side API routes
- `src/pages/reader`: frontend page route(s)
- `src/pages/_app.tsx`: application wrapper for Pages Router
- `src/pages/_document.tsx`: server-side document shell

So `src/pages` is mixed, not purely client-side.

## `src/services` breakdown

The most important point is this:

- `src/services` is mostly a shared application/service layer
- it is not the same thing as “backend code”
- actual HTTP server entrypoints are mainly under `src/pages/api` and `src/app/api`

### Top-level files in `src/services`

- `appService.ts`
  Base application service abstraction.

- `nativeAppService.ts`
  Native/Tauri-facing app service implementation.

- `nodeAppService.ts`
  Node-capable service implementation.

- `webAppService.ts`
  Web/browser-oriented service implementation.

- `bookService.ts`
  Book-level operations such as covers, metadata shaping, and book-related domain logic.

- `libraryService.ts`
  Library management logic.

- `settingsService.ts`
  Reading and persisting settings.

- `backupService.ts`
  Backup/import-export related logic.

- `cloudService.ts`
  Cloud-related app behavior.

- `fontService.ts`
  Custom font handling.

- `imageService.ts`
  Image-related helper logic.

- `ingestService.ts`
  Import / ingest pipeline for incoming content.

- `persistence.ts`
  Shared persistence utilities.

- `transformService.ts`
  Content transformation entrypoints.

- `commandRegistry.ts`
  Command registration / dispatch.

- `transferManager.ts` and `transferMessages.ts`
  Transfer pipeline coordination.

- `environment.ts` and `runtimeConfig.ts`
  Runtime environment detection and injected runtime configuration.

- `constants.ts` and `errors.ts`
  Shared constants and error types.

These top-level files are mostly shared client/application-layer code, with some runtime branching for web, node, and Tauri.

### `src/services/database`

Platform-specific database access and migrations.

- `webDatabaseService.ts`: browser/web DB implementation
- `nodeDatabaseService.ts`: Node-side DB implementation
- `nativeDatabaseService.ts`: native/Tauri DB implementation
- `migrate.ts` and `migrations/`: schema and migration logic

This is shared infrastructure code, not an HTTP backend directory.

### `src/services/sync`

Sync clients and replica-sync orchestration.

- legacy/remote sync client code such as `KOSyncClient.ts`
- replica sync flow: bootstrap, publish, pull, apply, persistence, cursor storage, encryption, and passphrase handling
- adapter subdirectory for sync categories such as dictionary, font, texture, OPDS catalog, and settings

This is mostly client-side sync orchestration talking to backend endpoints like `src/pages/api/sync.ts` and `src/pages/api/sync/replicas.ts`.

### `src/services/send`

“Send to Readest” and content conversion logic.

- `sendAddress.ts`, `devicePrefs.ts`, `inboxDrainer.ts`
- `conversion/`: article/page-to-EPUB conversion pipeline, sanitization, TOC building, asset bundling, and worker protocol

This is mostly application logic used by frontend flows and server endpoints together.

### `src/services/metadata`

Book metadata lookup services.

- provider implementations like Google Books and Open Library
- shared metadata types and orchestration service

This is shared integration logic. Actual HTTP exposure happens via route handlers such as `src/app/api/metadata/search`.

### `src/services/dictionaries`

Dictionary import, parsing, lookup, and provider registry.

- readers/parsers for StarDict, SLOB, and related formats
- provider adapters for dictionary/web/wikipedia/wiktionary sources
- dictionary service, deduplication, content ID, and lookup candidate generation

This is primarily client/application functionality.

### `src/services/annotation`

Annotation models and provider adapters.

- annotation types and normalization
- provider adapters such as Foliate and MR export/import

Mostly shared reader-side logic.

### `src/services/nav`

Navigation, fragments, grouping, locations, and lookup utilities for books.

Mostly client-side reader logic.

### `src/services/opds`

OPDS feed handling and subscription state.

- feed parsing/checking
- auto-download support
- stream and subscription helpers

Mostly frontend/domain logic, sometimes paired with server proxy routes.

### `src/services/translators`

Translation provider integration.

- provider adapters for DeepL, Google, Azure, Yandex
- preprocessing, cache, polish, and translator utilities

Mixed integration code. Some providers are used via server APIs to avoid exposing secrets.

### `src/services/tts`

Text-to-speech abstraction and implementations.

- `WebSpeechClient.ts`: browser TTS
- `NativeTTSClient.ts`: native/Tauri TTS
- `EdgeTTSClient.ts`: remote/provider-backed TTS
- controller/data/types/utilities

Mixed runtime code, mostly used by the reader frontend.

### `src/services/ai`

AI chat/embedding/RAG related abstractions.

- adapters and providers
- prompts, chunking, retry logic, logging
- local AI store and RAG service

Mixed integration code. The services are shared, while actual HTTP endpoints live under `src/app/api/ai`.

### `src/services/hardcover` and `src/services/readwise`

Third-party reading service integrations.

- Hardcover sync client and mapping store
- Readwise client integration

Mostly client/application integration code.

### `src/services/rsvp`

RSVP reader mode logic.

- controller, persistence, utilities, and types

Client-side reading feature code.

### `src/services/transformers`

Text/content transformation modules.

- language, punctuation, whitespace, proofread, sanitization, footnote, style, simplecc, warichu

Shared pure logic, usually frontend-facing but not tied to a single runtime.

## Practical mental model

If you want a fast rule of thumb for this repo, use this:

- HTTP backend entrypoints: `src/pages/api`, `src/app/api`, `workers`
- frontend UI/routes: `src/app` except `api`, plus `src/components`, `src/hooks`, `src/store`
- shared app/domain logic: `src/services`, `src/utils`, `src/libs`, `src/types`
- native host layer for desktop + Android + iOS: `src-tauri`

That model matches the codebase much better than “everything under `src` is client code.”
