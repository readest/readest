# Project Status

## Recent Session Highlights

### AI Chat & Layout Fixes (2026-01-23)

- **Implemented Cross-Platform Dialogs**: Added `AppService.ask` bridge to handle native Tauri dialogs on desktop and `window.confirm` on web.
- **Refined AI Chat "Clear" Button**: Trash icon now deselects the active conversation instead of deleting it, allowing users to clear the UI while preserving history in the sidebar.
- **Synchronized Sidebar Heights**: Adjusted `NotebookTabNavigation` (right sidebar) to match the height of `TabNavigation` (left sidebar) using a `min-h-[52px]` constraint.
- **CI/Lint Fixes**: Resolved a React Compiler error in `ChatHistoryView.tsx` by correctly adding `appService` to the `useCallback` dependency array.

## Tech Stack Notes

- **Frontend**: Next.js, React 19, Tailwind CSS.
- **State Management**: Zustand.
- **Platform**: Tauri (Desktop) & Web.
- **UI Architecture**: Using `@assistant-ui/react` for AI components.
