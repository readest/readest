// Shared helpers for the native import fast-path.
//
// Both the EPUB parser (`epub_parser`) and the MOBI/AZW/AZW3 parser
// (`mobi_parser`) need to:
//   - compute the same `partialMD5` over the input file as `utils/md5.ts`,
//     so the on-disk `Books/<hash>/...` layout stays stable regardless of
//     which parser produced the entry,
//   - clamp oversized cover artwork to the library-grid thumbnail size,
//     re-encoding as JPEG q85 when downscaling actually fires.
//
// Keeping these in a single module avoids drift between the two import
// paths (a divergent partialMD5 implementation would silently re-import
// every existing book under a new hash on the first run after a change).
//
// `RawCoverImage` is the IPC-shaped struct returned to JS as a byte array
// + MIME pair; the JS bridges (`tauriEpubBridge.ts`, `tauriMobiBridge.ts`)
// turn it back into a `Uint8Array` before persisting through the existing
// `Books/<hash>/cover.<ext>` path.

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, GenericImageView};
use md5::{Digest, Md5};
use serde::Serialize;
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

/// Cover thumbnail target. Sized for the library grid (~250-300px @2x)
/// and the reader-sidebar / detail-view rows (which are smaller still).
/// Anything whose long edge is already at or below this stays untouched —
/// no decode/re-encode, original bytes are kept verbatim. Anything larger
/// is downscaled with [`COVER_RESIZE_FILTER`] and re-encoded as JPEG q85.
pub const COVER_MAX_LONG_EDGE: u32 = 512;
pub const COVER_JPEG_QUALITY: u8 = 85;

/// Resampling filter used to downscale covers. We deliberately use
/// `Triangle` (4-tap bilinear-ish) instead of `Lanczos3` (36-tap): at the
/// 512px-thumbnail scale the visual difference is imperceptible, but
/// Triangle is ~5-8x faster on a debug build (and ~3-5x faster on release)
/// because it touches far fewer source pixels per output pixel. Cover
/// thumbnails are displayed at <=300px in the UI, so any sharpening
/// advantage Lanczos3 would have is moot.
pub const COVER_RESIZE_FILTER: FilterType = FilterType::Triangle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCoverImage {
    /// Raw image bytes (serde will encode this as a JS array; the JS side
    /// converts it back to a Uint8Array before writing to disk).
    pub bytes: Vec<u8>,
    pub mime: String,
}

/// Decode `bytes`, and if the long edge exceeds [`COVER_MAX_LONG_EDGE`],
/// resize ([`COVER_RESIZE_FILTER`], aspect ratio preserved) and re-encode
/// as JPEG at [`COVER_JPEG_QUALITY`].
///
/// On any decode/encode failure we fall back to the original bytes + the
/// caller-provided MIME so a malformed (but viewable) cover still makes it
/// to disk. `hint_mime` is informative only — `image::load_from_memory`
/// sniffs the actual format from the magic bytes, so misclaimed MIMEs in
/// the source container don't trip us up.
pub fn maybe_resize_cover(bytes: Vec<u8>, hint_mime: &str) -> (Vec<u8>, String) {
    let img = match image::load_from_memory(&bytes) {
        Ok(i) => i,
        Err(_) => return (bytes, hint_mime.to_string()),
    };
    let (w, h) = img.dimensions();
    if w.max(h) <= COVER_MAX_LONG_EDGE {
        return (bytes, hint_mime.to_string());
    }
    let resized = img.resize(
        COVER_MAX_LONG_EDGE,
        COVER_MAX_LONG_EDGE,
        COVER_RESIZE_FILTER,
    );
    let rgb = resized.to_rgb8();

    let mut out = Vec::with_capacity(64 * 1024);
    {
        let mut encoder = JpegEncoder::new_with_quality(Cursor::new(&mut out), COVER_JPEG_QUALITY);
        if encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .is_err()
        {
            return (bytes, hint_mime.to_string());
        }
    }
    (out, "image/jpeg".to_string())
}

/// Mirror of `utils/md5.ts::partialMD5`:
///   step = 1024, size = 1024
///   for i in -1..=10:
///     start = min(file.size, step << (2*i))   // JS 32-bit shift
///     end   = min(start + size, file.size)
///     if start >= file.size: break
///     hash file[start..end]
///
/// JS bit-shift operands are masked to their low 5 bits, so `1024 << -2`
/// actually means `1024 << 30`, which is far larger than any reasonable
/// file. That makes the very first iteration (i = -1) immediately break
/// for files smaller than ~1 GiB, leaving the hasher empty -> md5 of "" =
/// d41d8cd9... We must reproduce that behaviour bit-for-bit so existing
/// on-disk hashes (Books/<hash>/...) keep matching.
pub fn compute_partial_md5(path: &Path) -> std::io::Result<String> {
    const STEP: u32 = 1024;
    const CHUNK: u64 = 1024;

    let mut file = File::open(path)?;
    let file_len = file.metadata()?.len();

    let mut hasher = Md5::new();
    let mut buf = vec![0u8; CHUNK as usize];

    for i in -1i32..=10 {
        // JS evaluates `step << (2*i)` as a 32-bit shift, where the operand is
        // implicitly masked to its low 5 bits. So `1024 << -2` is the same as
        // `1024 << 30`, which overflows i32 to 0 (the high bits are dropped).
        // For i = 0..=4 the shift is 0..=8 and stays within i32; for i >= 5
        // the result overflows to 0 again. We mirror that with wrapping_shl.
        let shift_amount = ((2 * i) as u32) & 31;
        let shifted = (STEP as i32).wrapping_shl(shift_amount);
        // Negative i32 results coerce to 0 here. JS's Math.min would surface
        // the negative value, but the subsequent `start >= file.size` check
        // would skip the read; clamping to 0 gives the same observable
        // hash for non-empty files while avoiding negative seek offsets.
        let raw = shifted.max(0) as u64;
        let start = std::cmp::min(file_len, raw);
        if start >= file_len {
            break;
        }
        let end = std::cmp::min(start + CHUNK, file_len);
        let to_read = (end - start) as usize;
        file.seek(SeekFrom::Start(start))?;
        let slice = &mut buf[..to_read];
        file.read_exact(slice)?;
        hasher.update(&slice[..]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}
