# Windows Thumbnail Provider for Readest

This crate provides Windows Explorer thumbnail support for eBook files when Readest is set as the default application.

## Features

- **Automatic Cover Extraction**: Extracts cover images from EPUB, MOBI, AZW, AZW3, FB2, CBZ, CBR files
- **Readest Branding**: Adds a small Readest icon overlay at the bottom-right corner
- **Smart Caching**: Caches generated thumbnails for faster subsequent loads
- **File Association Aware**: Only shows thumbnails when Readest is the default app for the file type
- **COM Integration**: Full Windows Shell extension implementation via `IThumbnailProvider`

## Supported Formats

| Format | Extension | Cover Source |
|--------|-----------|--------------|
| EPUB | `.epub` | OPF manifest cover reference |
| MOBI/AZW | `.mobi`, `.azw`, `.prc` | EXTH cover offset |
| AZW3/KF8 | `.azw3`, `.kf8` | KF8 format cover |
| FB2 | `.fb2` | `<binary>` coverpage element |
| Comic Book | `.cbz`, `.cbr` | First image in archive |
| Plain Text | `.txt` | Generated placeholder |

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

The thumbnail provider DLL is automatically registered when Readest is installed via the NSIS installer.

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

- **CLSID**: `{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}`
- **Shell Thumbnail Handler GUID**: `{e357fccd-a995-4576-b01f-234630154e96}`
- **Threading Model**: Apartment

## How It Works

1. When Windows Explorer needs a thumbnail, it queries the registered shell extension
2. The COM DLL implements `IInitializeWithItem` to receive the file path
3. It checks if Readest.exe is the default application for that file type using `AssocQueryStringW`
4. If Readest is the default, it extracts the cover and generates the thumbnail
5. If Readest is NOT the default, it returns `S_FALSE` to let Windows use other handlers

This ensures thumbnails only appear for files the user has associated with Readest.

## License

MIT License - See LICENSE file for details.
