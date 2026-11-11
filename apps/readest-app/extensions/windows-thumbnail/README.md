# Windows Thumbnail Provider for Readest

This crate provides Windows Explorer thumbnail and preview pane support for eBook files when Readest is set as the default application.

## Features

- **Automatic Cover Extraction**: Extracts cover images from EPUB, MOBI, AZW, AZW3, FB2, CBZ, CBR files
- **PDF Rendering**: Renders PDF pages with `Windows.Data.Pdf`, the PDF engine built into Windows 10+
- **Preview Pane**: `IPreviewHandler` shows PDF pages (mouse wheel, scrollbar, arrow / Page Up / Page Down / Home / End turn pages) and the cover of other formats
- **Readest Branding**: Adds a small Readest icon overlay at the bottom-right corner
- **Smart Caching**: Caches generated thumbnails for faster subsequent loads
- **File Association Aware**: Only shows thumbnails when Readest is the default app for the file type
- **COM Integration**: Full Windows Shell extension implementation via `IThumbnailProvider`

## Supported Formats

| Format     | Extension               | Cover Source                 |
| ---------- | ----------------------- | ---------------------------- |
| EPUB       | `.epub`                 | OPF manifest cover reference |
| MOBI/AZW   | `.mobi`, `.azw`, `.prc` | EXTH cover offset            |
| AZW3/KF8   | `.azw3`, `.kf8`         | KF8 format cover             |
| FB2        | `.fb2`                  | `<binary>` coverpage element |
| Comic Book | `.cbz`, `.cbr`          | First image in archive       |
| PDF        | `.pdf`                  | First page                   |
| Plain Text | `.txt`                  | Generated placeholder        |

## Building

### Library Only

```bash
cargo build --release
```

### COM DLL (for Windows Explorer integration)

```bash
cargo build --release --features com
```

### CLI Tool

```bash
cargo build --release --features cli
```

## Installation

The NSIS installer registers the DLL for Explorer previews. File Explorer thumbnails are **off by default**. Enable **Settings → Behavior → File Explorer → Use Readest for File Explorer thumbnails** to opt in on this Windows account. The preference stays on this device and survives updates. Turning it off removes only Readest's thumbnail registrations; preview-pane handlers and other providers remain unchanged.

Upgrading from a version that registered thumbnails automatically removes those legacy registrations unless you have opted in. The setting requires the installed DLL; portable copies cannot enable it on their own.

### Manual Registration (for development)

```powershell
# Register the DLL
regsvr32 /s target\release\windows_thumbnail.dll

# Unregister the DLL
regsvr32 /s /u target\release\windows_thumbnail.dll

# Refresh Explorer to see changes
ie4uinit.exe -show
```

After registration, you may need to restart Windows Explorer or log out/in for changes to take effect.

## Usage (Development / Manual testing)

For local development and testing, build the Windows DLL (or the library) from the Readest Tauri app folder and register it manually. The legacy CLI test harness used to live in the separate `packages/tauri` workspace, but the thumbnail handler implementation now lives inside Readest's Tauri app.

Build the DLL (for Windows explorer integration):

```powershell
cd apps/readest-app/src-tauri
cargo build --release --manifest-path Cargo.toml --features com
```

The standalone CLI test harness is no longer distributed with the app. To test the thumbnail provider locally, build and register the DLL as shown above and use a small test harness that imports `readestlib`'s thumbnail code or use Explorer after registering the handler.

Manual registration for development (register the generated DLL):

```powershell
# Register the DLL
regsvr32 /s target\release\windows_thumbnail.dll

# Unregister the DLL
regsvr32 /s /u target\release\windows_thumbnail.dll

# Refresh Explorer to see changes
ie4uinit.exe -show
```

This generates a thumbnail with the Readest overlay at the specified size.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Windows Explorer                              │
├─────────────────────────────────────────────────────────────────┤
│                          │                                       │
│    IThumbnailProvider ───┼──► ThumbnailProvider                  │
│                          │         │                             │
│                          │         ▼                             │
│                          │    Check File Association             │
│                          │    (is Readest the default?)          │
│                          │         │                             │
│                          │         ▼ (if yes)                    │
│                          │    Extract Cover Image                │
│                          │         │                             │
│                          │         ▼                             │
│                          │    Add Readest Overlay                │
│                          │         │                             │
│                          │         ▼                             │
│                          │    Return HBITMAP                     │
│                          │                                       │
└─────────────────────────────────────────────────────────────────┘
```

## COM Details

- **CLSID**: `{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}` (one class serves both handlers)
- **Shell Thumbnail Handler GUID**: `{e357fccd-a995-4576-b01f-234630154e96}`
- **Shell Preview Handler GUID**: `{8895b1c6-b41f-4c1c-a562-0d564250836f}`, hosted by `prevhost.exe` (AppID `{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}`)
- **Threading Model**: Apartment

## How It Works

1. When Windows Explorer needs a thumbnail, it queries the registered shell extension
2. The COM DLL implements `IInitializeWithItem` to receive the file path
3. It checks if Readest.exe is the default application for that file type using `AssocQueryStringW`
4. If Readest is the default, it extracts the cover and generates the thumbnail
5. If Readest is NOT the default, it returns `S_FALSE` to let Windows use other handlers

This ensures thumbnails only appear for files the user has associated with Readest.

Thumbnail opt-in and preview registration claim an extension's slot only when it is empty or already Readest's. Opt-out and uninstall remove only Readest's own entries, so handlers from other apps (e.g. SageThumbs, Edge's PDF previewer, Adobe, SumatraPDF) are left alone.

### Installer regression test

From `src-tauri/nsis/tests`, compile `makensis explorer-thumbnails.nsi` and run `explorer-thumbnails-test.exe` in a disposable Windows user account or isolated Wine prefix. The harness writes fixture registry entries and reports its result in `explorer-thumbnails-test.log`; never run it against your normal Windows registry. It covers the default, legacy registration migration, per-user and machine install scopes, opt-in persistence, opt-out, uninstall, and third-party handlers.

## License

MIT License - See LICENSE file for details.
