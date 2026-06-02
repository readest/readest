// Native MOBI/AZW/AZW3 import path.
//
// Scope after PR review (mirrors `epub_parser`): this command no
// longer extracts MOBI metadata. The full set of EXTH semantics
// (placeholder filtering, ISBN-10/13 checksum validation, ASIN
// fallback, BCP-47 language normalisation, " & " / " and " / ";"
// author splitting, HTML-stripped descriptions, …) is left to
// foliate-js's `mobi.js`, which the JS side already runs through
// `DocumentLoader.open()` on the import path. Re-implementing those
// rules in Rust would silently diverge from the canonical parser
// used by the reader hot path; worse, switching `Book.metadata.identifier`
// from the foliate `mobi.uid` (PalmDB UID) to a Rust-derived ISBN/ASIN
// would change the metaHash for every existing MOBI in users' libraries
// and trigger spurious re-imports on upgrade.
//
// What `parse_mobi_metadata` still does on the import hot path:
//   - compute partialMD5 over the file (matches `utils/md5.ts::partialMD5`,
//     shared with `epub_parser` via `parser_common::compute_partial_md5`);
//   - parse the PalmDB / MobiHeader / EXTH headers via the `mobi` crate
//     just enough to locate the cover record;
//   - locate the cover image (EXTH `CoverOffset` 201 → `ThumbOffset` 202
//     → first image record fallback), sniff the MIME from magic bytes,
//     and run `parser_common::maybe_resize_cover` to clamp it to the
//     library-grid thumbnail target. Cover decode/resize stays here
//     because the `image` crate is materially faster than the
//     `createImageBitmap` + canvas round-trip on Android mid-tier
//     devices, and bulk imports actually exercise that.
//
// Returned to JS via `parse_mobi_metadata`. The JS bridge wraps the
// downscaled bytes into a Blob and Proxies it onto foliate's BookDoc
// in place of the foliate `getCover()` (which would otherwise return
// the original-resolution bytes). foliate stays the source of truth
// for everything else.

use mobi::headers::ExthRecord;
use mobi::Mobi;
use serde::Serialize;
use std::path::Path;

use crate::parser_common::{compute_partial_md5, maybe_resize_cover, RawCoverImage};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMobi {
    pub partial_md5: String,
    /// `None` when the MOBI has no embedded cover image. Otherwise
    /// the pre-resized bytes + sniffed MIME — the JS side wraps them
    /// in a Blob and overrides foliate's `getCover()` so the on-disk
    /// thumbnail wins over foliate's full-resolution decode.
    pub cover: Option<RawCoverImage>,
}

/// Tauri command: parse a MOBI/AZW/AZW3 file's partialMD5 + cover and
/// return both in one IPC round-trip.
///
/// Runs on a blocking pool because `mobi::Mobi::from_path` reads the
/// whole file synchronously and parsing a 50 MB AZW3 can take tens of
/// milliseconds — long enough to want it off the Tauri main runtime.
#[tauri::command]
pub async fn parse_mobi_metadata(file_path: String) -> Result<ParsedMobi, String> {
    tauri::async_runtime::spawn_blocking(move || parse_mobi_metadata_sync(&file_path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn parse_mobi_metadata_sync(file_path: &str) -> Result<ParsedMobi, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("file not found: {file_path}"));
    }

    let partial_md5 = compute_partial_md5(path).map_err(|e| format!("partial_md5 failed: {e}"))?;

    let mobi = Mobi::from_path(path).map_err(|e| format!("parse mobi: {e}"))?;

    let cover = extract_cover(&mobi).map(|raw| {
        let (bytes, mime) = maybe_resize_cover(raw.bytes, &raw.mime);
        RawCoverImage { bytes, mime }
    });

    Ok(ParsedMobi { partial_md5, cover })
}

/// Extract the *original* (un-resized) cover bytes from a MOBI / AZW / AZW3.
///
/// Mirrors `epub_parser::extract_epub_cover_full`: the import path stores a
/// downscaled thumbnail (via `maybe_resize_cover` inside
/// `parse_mobi_metadata_sync`) for the library grid, but features like the
/// Android / iOS lock-screen wallpaper want the full-resolution artwork. We
/// re-run the same EXTH lookup as the import path here, but skip the
/// downscale step and hand the raw record bytes back to JS along with a
/// MIME sniffed from the magic bytes.
///
/// Returns `Err` only when the file has no embedded cover at all.
#[tauri::command]
pub async fn extract_mobi_cover_full(file_path: String) -> Result<RawCoverImage, String> {
    tauri::async_runtime::spawn_blocking(move || extract_mobi_cover_full_sync(&file_path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn extract_mobi_cover_full_sync(file_path: &str) -> Result<RawCoverImage, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("file not found: {file_path}"));
    }
    let mobi = Mobi::from_path(path).map_err(|e| format!("parse mobi: {e}"))?;
    extract_cover(&mobi).ok_or_else(|| "no cover image in mobi".to_string())
}

/// Locate and decode the embedded cover image.
///
/// Strategy (mirrors what foliate-js's mobi.js does on the JS side):
///   1. Read EXTH `CoverOffset` (record 201). The payload is a 4-byte
///      big-endian u32 giving an offset into the image-record subset.
///      Add `MobiHeader.first_image_index` to get a global PDB record
///      index, then look that record up in `Mobi::image_records()`.
///   2. If 201 is missing, try `ThumbOffset` (record 202) the same way.
///   3. If neither is present, fall back to the first image record —
///      MOBI generators almost always place the cover first, and a
///      "wrong but plausible" thumbnail is better than no thumbnail.
///
/// Returns `None` only when the file has no image records at all (rare
/// for real Kindle content).
fn extract_cover(mobi: &Mobi) -> Option<RawCoverImage> {
    let images = mobi.image_records();
    if images.is_empty() {
        return None;
    }

    let first_image_index = mobi.metadata.mobi.first_image_index;

    let exth_offset = read_exth_u32(mobi, ExthRecord::CoverOffset)
        .or_else(|| read_exth_u32(mobi, ExthRecord::ThumbOffset));

    let bytes: Vec<u8> = if let Some(off) = exth_offset {
        // EXTH stores a *relative* offset; the absolute PDB record id
        // is `first_image_index + off`. `image_records()` is filtered
        // to image-only records, so we have to find the entry whose
        // PdbRecord id matches the absolute id, not index linearly.
        let target_id = first_image_index.saturating_add(off);
        images
            .iter()
            .find(|r| r.record.id == target_id)
            // Some files store the offset already pre-resolved into
            // image_records()'s ordering; allow that as a fallback.
            .or_else(|| images.get(off as usize))
            .map(|r| r.content.to_vec())
            .unwrap_or_else(|| images[0].content.to_vec())
    } else {
        images[0].content.to_vec()
    };

    if bytes.is_empty() {
        return None;
    }

    let mime = sniff_image_mime(&bytes).to_string();
    Some(RawCoverImage { bytes, mime })
}

/// Read the first occurrence of `record` and interpret its payload as
/// a 4-byte big-endian u32. EXTH offset records (201 / 202 / 116, etc.)
/// follow this convention. Returns `None` if the record is absent or
/// shorter than 4 bytes.
fn read_exth_u32(mobi: &Mobi, record: ExthRecord) -> Option<u32> {
    let recs = mobi.metadata.exth.get_record(record)?;
    let bytes = recs.first()?;
    if bytes.len() < 4 {
        return None;
    }
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// Best-effort MIME sniffing from magic bytes for the formats MOBI
/// covers are realistically stored as. Falls back to "image/jpeg" —
/// the dominant case — when the magic is unknown, because
/// `image::load_from_memory` (called downstream by
/// `maybe_resize_cover`) will detect the real format anyway and the
/// hint MIME is only used when we *don't* re-encode (small covers,
/// kept verbatim).
///
/// BMP is included because some early KindleGen builds (and a few
/// self-published .prc files) shipped BMP covers; the JS thumbnail
/// pipeline can render BMP via the same downscale path.
fn sniff_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        "image/png"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        "image/jpeg"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_image_mime_jpeg() {
        assert_eq!(sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
    }

    #[test]
    fn sniff_image_mime_png() {
        assert_eq!(
            sniff_image_mime(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]),
            "image/png"
        );
    }

    #[test]
    fn sniff_image_mime_gif() {
        assert_eq!(sniff_image_mime(b"GIF89a..."), "image/gif");
    }

    #[test]
    fn sniff_image_mime_webp() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&[0, 0, 0, 0]);
        buf.extend_from_slice(b"WEBP");
        assert_eq!(sniff_image_mime(&buf), "image/webp");
    }

    #[test]
    fn sniff_image_mime_unknown_falls_back_to_jpeg() {
        assert_eq!(sniff_image_mime(&[0, 0, 0, 0]), "image/jpeg");
    }

    #[test]
    fn sniff_image_mime_bmp() {
        // BMP magic is "BM" followed by file size + reserved + offset.
        let mut buf = Vec::new();
        buf.extend_from_slice(b"BM");
        buf.extend_from_slice(&[0; 12]);
        assert_eq!(sniff_image_mime(&buf), "image/bmp");
    }
}
