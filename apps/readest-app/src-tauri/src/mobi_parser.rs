// Native MOBI/AZW/AZW3 import path.
//
// Mirrors the EPUB fast-path (see `epub_parser`) but for the MOBI
// container family (PalmDB + MobiHeader + EXTH, optionally KF8/AZW3).
// On import we run *exactly* the work the JS-side `DocumentLoader.open()`
// would need to extract for the importer to persist a library row + a
// cover thumbnail, but in Rust:
//
//   - compute partialMD5 over the file (matches `utils/md5.ts::partialMD5`,
//     shared with `epub_parser` via `parser_common::compute_partial_md5`),
//   - parse PalmDB / MobiHeader / EXTH via the `mobi` crate,
//   - extract title / author / publisher / description / publish_date /
//     isbn / contributor / subjects / language,
//   - fall back to ASIN (EXTH 113) as the identifier when ISBN is absent —
//     MOBI files almost never carry an ISBN but Kindle-side files always
//     have an ASIN, which the JS side already happily uses as the unique
//     book id (see `utils/book.ts`),
//   - locate the cover image: EXTH `CoverOffset` (record 201) gives a
//     u32 BE offset relative to `MobiHeader.first_image_index`, which
//     indexes into `Mobi::image_records()` to recover the raw
//     jpeg/png/gif bytes. If 201 is missing we try `ThumbOffset` (202)
//     and finally fall back to the first image record. We sniff the
//     real MIME from the magic bytes (the EXTH gives no MIME hint) and
//     hand off to `parser_common::maybe_resize_cover` for the same
//     library-grid thumbnail clamp the EPUB path applies,
//   - return `partialMd5` + structured metadata + cover bytes/MIME so
//     the JS bridge can build a `BookDoc` shim equivalent to what
//     foliate-js's `mobi.js` would have produced — without the JS
//     having to inflate the entire record stream up front.
//
// Returned to JS via the `parse_mobi_metadata` Tauri command. The JS
// side continues to drive sectioned reading at runtime (foliate-js
// is reopened lazily on the reader hot path), so this module is
// import-only and never touched after the library row is created.

use mobi::headers::{ExthRecord, Language};
use mobi::Mobi;
use serde::Serialize;
use std::path::Path;

use crate::parser_common::{compute_partial_md5, maybe_resize_cover, RawCoverImage};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMobiMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    /// Best-effort ISO-639-1 lowercase code (e.g. "en", "zh", "ja").
    /// `mobi` crate's `Language` enum maps the PalmDB locale byte to a
    /// language *name*, not an ISO code, so we provide a small lookup
    /// table here covering the common cases. Anything we can't map
    /// falls back to the lowercase Debug name (e.g. "rhaetoromanic"),
    /// which the JS side treats as opaque metadata for display.
    pub language: Option<String>,
    /// ISBN if EXTH record 104 is set, otherwise the ASIN from EXTH 113.
    /// MOBI files almost never carry an ISBN but always carry an ASIN
    /// when produced by KindleGen, and the JS importer already accepts
    /// either as the book identifier.
    pub identifier: Option<String>,
    pub isbn: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub description: Option<String>,
    pub subject: Vec<String>,
    /// "MOBI" / "AZW3" — derived from `format_version`. AZW (the older
    /// Kindle-1 format) is structurally identical to MOBI as far as the
    /// importer cares, so it lands in the same bucket; the JS bridge
    /// overrides this with the file extension when more specific.
    pub kf_format: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMobi {
    pub partial_md5: String,
    pub metadata: ParsedMobiMetadata,
    /// `None` when the MOBI has no embedded cover image. The JS side
    /// then falls back to its existing "no cover" placeholder.
    pub cover: Option<RawCoverImage>,
}

/// Tauri command: parse a MOBI/AZW/AZW3 file's metadata + cover and
/// return everything the importer needs in one IPC round-trip.
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

    // ---- metadata -------------------------------------------------------
    // `Mobi::title()` already does EXTH 503 (`Title`) -> MOBI `name`
    // fallback internally, matching mobi-book / Calibre's resolution
    // order. We just have to strip placeholder titles ("Unknown",
    // "Untitled", a single tool signature like "calibre 5.44.0", …)
    // so they don't end up displayed in the library; bookService
    // already substitutes the filename when `metadata.title` is empty.
    let title_raw = mobi.title();
    let title = clean_optional(Some(title_raw));

    // MOBI authors are stored as a single EXTH 100 string. Some files
    // pack multiple authors in one record separated by " & " or "; ".
    // We then drop any individual entry that looks like a placeholder
    // / tool signature (e.g. KindleGen sometimes writes
    // "Unknown Author" or "calibre 6.0.0" into EXTH 100).
    let authors: Vec<String> = mobi
        .author()
        .map(|a| split_multi_value(&a))
        .unwrap_or_default()
        .into_iter()
        .filter(|a| !is_placeholder(a))
        .collect();

    let publisher = clean_optional(mobi.publisher());
    let published = clean_optional(mobi.publish_date());
    let description = mobi.description().map(strip_html_tags).and_then(clean);

    // ISBN: drop the value when it fails the ISBN-10 / ISBN-13
    // checksum test. KindleGen sometimes writes 0000000000000 or
    // truncated digits to EXTH 104, and pirated MOBIs often inherit a
    // wrong ISBN from the source EPUB — both look "real" downstream
    // (book detail UI, OPDS sync) until they're queried against an
    // ISBN database, so it's better to drop them at import time than
    // to let them poison `Book.metadata.isbn`.
    let raw_isbn = mobi.isbn();
    let isbn = raw_isbn.clone().filter(|s| is_valid_isbn(s));

    // ASIN (EXTH 113) is the de-facto Kindle identifier when no ISBN
    // is present. `exth_record` returns &Vec<Vec<u8>> because the same
    // record can appear multiple times; we take the first.
    let asin = read_exth_string(&mobi, ExthRecord::Asin).filter(|s| !is_placeholder(s));

    // Identifier preference: validated ISBN > ASIN. We deliberately
    // *don't* fall back to a checksum-failing ISBN here because doing
    // so would make `Book.metadata.identifier` worse than not having
    // one at all (the JS importer treats a present-but-wrong ISBN as
    // the canonical id and would dedupe against unrelated books).
    let identifier = isbn.clone().or(asin);

    let subject: Vec<String> = mobi
        .metadata
        .subjects()
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !is_placeholder(s))
        .collect();

    // Language resolution order:
    //   1. EXTH 524 — the BCP-47 string KindleGen and Calibre write
    //      ("zh-cn", "en-US", "ja"). vv9k's `mobi.language()` ignores
    //      this and only reads the PDB locale byte, which is often
    //      `Neutral` on AZW3 even when EXTH 524 is set.
    //   2. PDB locale byte mapped through `language_to_iso_code`.
    let language = read_exth_string(&mobi, ExthRecord::Language)
        .map(|s| normalize_bcp47(&s))
        .filter(|s| !s.is_empty())
        .or_else(|| language_to_iso_code(mobi.language()));

    let kf_format = if mobi.metadata.mobi.format_version >= 8 {
        "AZW3"
    } else {
        "MOBI"
    };

    let metadata = ParsedMobiMetadata {
        title,
        authors,
        language,
        identifier,
        isbn,
        publisher,
        published,
        description,
        subject,
        kf_format,
    };

    // ---- cover ----------------------------------------------------------
    let cover = extract_cover(&mobi).map(|raw| {
        let (bytes, mime) = maybe_resize_cover(raw.bytes, &raw.mime);
        RawCoverImage { bytes, mime }
    });

    Ok(ParsedMobi {
        partial_md5,
        metadata,
        cover,
    })
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

/// Map the `mobi` crate's `Language` enum (which has no `Display`
/// impl and no built-in ISO-639 lookup) to a lowercase ISO-639-1 code
/// covering the languages we realistically see in user libraries.
/// Anything outside this list falls back to a lowercased Debug name,
/// which the JS side displays verbatim and ignores for filtering.
fn language_to_iso_code(lang: Language) -> Option<String> {
    let code = match lang {
        Language::Neutral => return None,
        Language::Unknown => return None,
        Language::English => "en",
        Language::Chinese => "zh",
        Language::Japanese => "ja",
        Language::Korean => "ko",
        Language::French => "fr",
        Language::German => "de",
        Language::Spanish => "es",
        Language::Italian => "it",
        Language::Portuguese => "pt",
        Language::Russian => "ru",
        Language::Dutch => "nl",
        Language::Arabic => "ar",
        Language::Hebrew => "he",
        Language::Hindi => "hi",
        Language::Bengali => "bn",
        Language::Turkish => "tr",
        Language::Polish => "pl",
        Language::Swedish => "sv",
        Language::Norwegian => "no",
        Language::Danish => "da",
        Language::Finnish => "fi",
        Language::Czech => "cs",
        Language::Hungarian => "hu",
        Language::Greek => "el",
        Language::Romanian => "ro",
        Language::Ukrainian => "uk",
        Language::Vietnamese => "vi",
        Language::Thai => "th",
        Language::Indonesian => "id",
        Language::Malay => "ms",
        Language::Catalan => "ca",
        Language::Bulgarian => "bg",
        other => return Some(format!("{other:?}").to_lowercase()),
    };
    Some(code.to_string())
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

/// Trim a string and treat the empty result as `None`. Used as the
/// final cleanup step on every metadata field that the JS importer
/// then writes verbatim into the library row.
fn clean(s: String) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Trim + drop placeholders. Convenience wrapper used by the metadata
/// extraction pipeline so each per-field call site stays a one-liner.
/// Returns `None` for both genuinely empty input *and* values that
/// match the `is_placeholder` heuristic ("Unknown", a single tool
/// signature like "calibre 5.44.0", a single ASCII punctuation, …).
fn clean_optional(s: Option<String>) -> Option<String> {
    let inner = s?;
    let trimmed = inner.trim();
    if trimmed.is_empty() || is_placeholder(trimmed) {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Best-effort placeholder/junk detector for free-form metadata
/// strings (title / author / publisher / contributor / subject).
///
/// MOBI files in the wild — especially those run through Calibre or
/// KindleGen — frequently carry literal `"Unknown"` / `"Untitled"` /
/// tool signatures (`"calibre 5.44.0"`, `"kindlegen 2.9 build…"`) in
/// the EXTH records. These get rendered verbatim in the library UI
/// unless we drop them at import time. Mirrors the spirit of
/// mobi-book's `quality::is_placeholder` while staying narrowly
/// conservative — we only filter values we're confident are noise.
fn is_placeholder(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return true;
    }
    // A single ASCII punctuation character ("-", ".", "?", …) is
    // never a real metadata value but is a common KindleGen output
    // when a field is missing in the source XML.
    if trimmed.chars().count() == 1
        && trimmed
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_punctuation())
    {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "unknown"
            | "unknown author"
            | "unknown title"
            | "n/a"
            | "na"
            | "tba"
            | "tbd"
            | "none"
            | "null"
            | "nil"
            | "untitled"
            | "no title"
            | "no author"
            | "title"
            | "author"
            | "test"
            | "default"
    ) || is_tool_signature(&lower)
}

/// Detect strings that are obviously a tool's self-identification
/// rather than real metadata. Calibre / KindleGen / Sigil sometimes
/// stamp their own version into EXTH 100 (Author) or 503 (Title)
/// when the source had nothing to write — usually as
/// "<tool> <version>".
fn is_tool_signature(lower: &str) -> bool {
    lower.starts_with("calibre ")
        || lower.starts_with("calibre-")
        || lower == "calibre"
        || lower.starts_with("kindlegen ")
        || lower.starts_with("kindlegen-")
        || lower == "kindlegen"
        || lower.starts_with("sigil ")
        || lower.starts_with("sigil-")
        || lower == "sigil"
        || lower.starts_with("ebook-convert")
}

/// Read the first occurrence of `record` from EXTH and decode it as
/// UTF-8 (lossy for the rare malformed payload). Returns `None` if
/// the record is absent or its decoded form is empty after trimming.
///
/// Used for string-typed EXTH records (Title 503, Language 524,
/// ASIN 113, …); offset records use `read_exth_u32` instead.
fn read_exth_string(mobi: &Mobi, record: ExthRecord) -> Option<String> {
    let recs = mobi.metadata.exth.get_record(record)?;
    let bytes = recs.first()?;
    let s = String::from_utf8_lossy(bytes).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Validate a candidate ISBN string against the ISBN-10 and ISBN-13
/// checksums. Accepts hyphens and spaces (commonly present in EXTH
/// 104 when KindleGen copies the value straight from the source OPF).
///
/// Returning `false` here causes the importer to drop the value, so
/// `Book.metadata.isbn` stays empty rather than holding a wrong-but-
/// plausible string. We deliberately don't try to "fix" or normalise
/// the ISBN — if the checksum fails, the source data is wrong and
/// the JS layer is better off without it.
fn is_valid_isbn(s: &str) -> bool {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    match cleaned.len() {
        13 => is_valid_isbn_13(&cleaned),
        10 => is_valid_isbn_10(&cleaned),
        _ => false,
    }
}

/// ISBN-10 checksum: sum of (digit_i * (10 - i)) for i in 0..10 must
/// be divisible by 11. The last position may be the literal 'X' /
/// 'x' to represent the value 10 — handled here.
fn is_valid_isbn_10(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let mut sum: u32 = 0;
    for (i, c) in s.chars().enumerate() {
        let v: u32 = if i == 9 && (c == 'X' || c == 'x') {
            10
        } else if let Some(d) = c.to_digit(10) {
            d
        } else {
            return false;
        };
        sum += v * (10 - i as u32);
    }
    sum % 11 == 0
}

/// ISBN-13 checksum: sum of (digit_i * weight_i) where weight is 1 for
/// even indices and 3 for odd indices, must be divisible by 10.
///
/// We additionally reject the all-zero string explicitly because
/// `0000000000000` *does* satisfy the modular check (0 % 10 == 0) but
/// is the literal placeholder KindleGen writes when the source OPF
/// has no ISBN. Letting it through would make `Book.metadata.isbn`
/// hold a wrong-but-valid-looking value that the JS side then uses as
/// a dedupe key — far worse than no ISBN at all.
fn is_valid_isbn_13(s: &str) -> bool {
    if s.len() != 13 {
        return false;
    }
    if s.chars().all(|c| c == '0') {
        return false;
    }
    // ISBN-13 prefixes are "978" or "979"; anything else (in
    // particular "000…") is not a real ISBN even if the checksum
    // accidentally validates.
    if !(s.starts_with("978") || s.starts_with("979")) {
        return false;
    }
    let mut sum: u32 = 0;
    for (i, c) in s.chars().enumerate() {
        let d = match c.to_digit(10) {
            Some(d) => d,
            None => return false,
        };
        sum += if i % 2 == 0 { d } else { d * 3 };
    }
    sum % 10 == 0
}

/// Normalise a BCP-47 language tag from EXTH 524 to a stable form.
/// Keeps the `language-region` shape (which the JS side relies on for
/// CJK font selection — `zh-cn` vs `zh-tw` matter), lowercases the
/// whole tag for consistent comparison, and trims surrounding
/// whitespace. We don't validate against the IANA registry — values
/// outside the spec are still surfaced verbatim because users have
/// been bitten by overly strict filtering ("zho", "cmn", custom
/// codes from regional publishers).
fn normalize_bcp47(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

/// Split a single-line author string on common multi-author separators.
/// Many MOBI files pack co-authors as `"A & B"`, `"A; B"`, or `"A, B"`
/// in EXTH 100. We split conservatively — only on `" & "`, `";"`, and
/// `" and "` — to avoid mangling single names that legitimately
/// contain commas (`"Smith, John"` for "lastname, firstname").
fn split_multi_value(s: &str) -> Vec<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    // Try " & " / " and " / ";" — each is unambiguous as a separator.
    for sep in [" & ", " and ", ";"] {
        if trimmed.contains(sep) {
            return trimmed
                .split(sep)
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect();
        }
    }
    vec![trimmed.to_string()]
}

/// Strip HTML tags from a description record. KindleGen wraps the
/// `<dc:description>` content in HTML (`<p>`, `<br/>`, …) before
/// stuffing it into EXTH 103, but the library/detail UI on the JS
/// side renders descriptions as plain text. Decoding here keeps the
/// JS side simple and consistent with what the EPUB path produces
/// (where descriptions are taken from OPF dc:description as raw text).
fn strip_html_tags(input: String) -> String {
    if !input.contains('<') {
        return input;
    }
    // Replace every tag with a single space so that inline tags like
    // `<br/>` between words don't fuse the surrounding tokens (e.g.
    // `Line1<br/>Line2` -> `Line1 Line2`, not `Line1Line2`). The
    // whitespace-collapse pass below normalises any runs we create.
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    // Collapse runs of whitespace introduced by stripped block tags.
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_ws = false;
    for ch in out.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                collapsed.push(' ');
                prev_ws = true;
            }
        } else {
            collapsed.push(ch);
            prev_ws = false;
        }
    }
    collapsed.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_multi_value_single() {
        assert_eq!(split_multi_value("Jane Austen"), vec!["Jane Austen"]);
    }

    #[test]
    fn split_multi_value_ampersand() {
        assert_eq!(split_multi_value("Strunk & White"), vec!["Strunk", "White"]);
    }

    #[test]
    fn split_multi_value_semicolon() {
        assert_eq!(
            split_multi_value("A. Smith; B. Jones; C. Wu"),
            vec!["A. Smith", "B. Jones", "C. Wu"]
        );
    }

    #[test]
    fn split_multi_value_keeps_lastname_firstname() {
        // "Smith, John" should NOT be split — that's lastname-first,
        // not two authors. Our separators don't include bare commas,
        // so this stays as a single name.
        assert_eq!(split_multi_value("Smith, John"), vec!["Smith, John"]);
    }

    #[test]
    fn split_multi_value_trims_and_filters_empty() {
        assert_eq!(split_multi_value("A;  ;B"), vec!["A", "B"]);
    }

    #[test]
    fn strip_html_handles_plain_text() {
        assert_eq!(strip_html_tags("hello world".to_string()), "hello world");
    }

    #[test]
    fn strip_html_strips_tags_and_collapses_ws() {
        assert_eq!(
            strip_html_tags("<p>Hello</p>  <p>World</p>".to_string()),
            "Hello World"
        );
    }

    #[test]
    fn strip_html_handles_self_closing_br() {
        assert_eq!(
            strip_html_tags("Line1<br/>Line2".to_string()),
            "Line1 Line2"
        );
    }

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
    fn language_to_iso_code_known() {
        assert_eq!(
            language_to_iso_code(Language::English).as_deref(),
            Some("en")
        );
        assert_eq!(
            language_to_iso_code(Language::Chinese).as_deref(),
            Some("zh")
        );
        assert_eq!(
            language_to_iso_code(Language::Japanese).as_deref(),
            Some("ja")
        );
    }

    #[test]
    fn language_to_iso_code_neutral_is_none() {
        assert_eq!(language_to_iso_code(Language::Neutral), None);
        assert_eq!(language_to_iso_code(Language::Unknown), None);
    }

    #[test]
    fn language_to_iso_code_unmapped_falls_back_to_debug_name() {
        // Esperanto doesn't exist in mobi's enum, but Sami does and
        // isn't in our hot list — verify it lowercases the Debug name.
        assert_eq!(
            language_to_iso_code(Language::Sami).as_deref(),
            Some("sami")
        );
    }

    // ---- placeholder filtering -----------------------------------------

    #[test]
    fn is_placeholder_empty_and_whitespace() {
        assert!(is_placeholder(""));
        assert!(is_placeholder("   "));
    }

    #[test]
    fn is_placeholder_known_words() {
        assert!(is_placeholder("Unknown"));
        assert!(is_placeholder("unknown"));
        assert!(is_placeholder("UNKNOWN"));
        assert!(is_placeholder("Unknown Author"));
        assert!(is_placeholder("Untitled"));
        assert!(is_placeholder("n/a"));
        assert!(is_placeholder("None"));
        assert!(is_placeholder("TBD"));
    }

    #[test]
    fn is_placeholder_single_punctuation() {
        assert!(is_placeholder("-"));
        assert!(is_placeholder("."));
        assert!(is_placeholder("?"));
    }

    #[test]
    fn is_placeholder_tool_signatures() {
        assert!(is_placeholder("calibre 5.44.0"));
        assert!(is_placeholder("calibre-6.0.0"));
        assert!(is_placeholder("Calibre"));
        assert!(is_placeholder("kindlegen 2.9 build 1028-0897292"));
        assert!(is_placeholder("Sigil 1.9.0"));
        assert!(is_placeholder("ebook-convert 5.0"));
    }

    #[test]
    fn is_placeholder_keeps_real_values() {
        // Real-world strings that look superficially noisy but are
        // legitimate metadata. None of these should be filtered.
        assert!(!is_placeholder("Jane Austen"));
        assert!(!is_placeholder("Pride and Prejudice"));
        assert!(!is_placeholder("J.R.R. Tolkien"));
        assert!(!is_placeholder("12 Rules for Life"));
        assert!(!is_placeholder("O'Reilly Media"));
        // "Test" alone is filtered, but "Test-Driven Development" is real.
        assert!(!is_placeholder("Test-Driven Development"));
    }

    #[test]
    fn clean_optional_drops_empty_and_placeholders() {
        assert_eq!(clean_optional(None), None);
        assert_eq!(clean_optional(Some("".to_string())), None);
        assert_eq!(clean_optional(Some("   ".to_string())), None);
        assert_eq!(clean_optional(Some("Unknown".to_string())), None);
        assert_eq!(clean_optional(Some("calibre 6.0".to_string())), None);
        assert_eq!(
            clean_optional(Some("  Real Title  ".to_string())).as_deref(),
            Some("Real Title")
        );
    }

    // ---- ISBN validation -----------------------------------------------

    #[test]
    fn is_valid_isbn_10_examples() {
        // "The C Programming Language" (Kernighan & Ritchie)
        assert!(is_valid_isbn_10("0131103628"));
        // ISBN-10 with X check digit ("Don Quixote")
        assert!(is_valid_isbn_10("043942089X"));
    }

    #[test]
    fn is_valid_isbn_10_rejects_wrong_checksum() {
        assert!(!is_valid_isbn_10("0131103629"));
        assert!(!is_valid_isbn_10("0000000001"));
    }

    #[test]
    fn is_valid_isbn_10_rejects_wrong_length() {
        assert!(!is_valid_isbn_10("123"));
        assert!(!is_valid_isbn_10("01311036280")); // 11 chars
    }

    #[test]
    fn is_valid_isbn_13_examples() {
        // "The C Programming Language" (Kernighan & Ritchie)
        assert!(is_valid_isbn_13("9780131103627"));
        // Common test vector
        assert!(is_valid_isbn_13("9780306406157"));
    }

    #[test]
    fn is_valid_isbn_13_rejects_wrong_checksum() {
        assert!(!is_valid_isbn_13("9780131103628"));
        // KindleGen sometimes writes all zeros — must be filtered.
        assert!(!is_valid_isbn_13("0000000000000"));
    }

    #[test]
    fn is_valid_isbn_13_rejects_non_digits() {
        assert!(!is_valid_isbn_13("978013110362X"));
    }

    #[test]
    fn is_valid_isbn_dispatch() {
        // 13 digits → ISBN-13 path
        assert!(is_valid_isbn("9780131103627"));
        // 10 digits → ISBN-10 path
        assert!(is_valid_isbn("0131103628"));
        // 9 digits + X → ISBN-10 path
        assert!(is_valid_isbn("043942089X"));
        // Hyphens / spaces tolerated
        assert!(is_valid_isbn("978-0-13-110362-7"));
        assert!(is_valid_isbn("0 13 110362 8"));
        // Invalid lengths and garbage
        assert!(!is_valid_isbn(""));
        assert!(!is_valid_isbn("not-an-isbn"));
        assert!(!is_valid_isbn("00000"));
    }

    // ---- BCP-47 normalisation ------------------------------------------

    #[test]
    fn normalize_bcp47_keeps_region() {
        assert_eq!(normalize_bcp47("zh-CN"), "zh-cn");
        assert_eq!(normalize_bcp47("en-US"), "en-us");
        assert_eq!(normalize_bcp47("  ja  "), "ja");
        assert_eq!(normalize_bcp47("zh-Hant-TW"), "zh-hant-tw");
    }

    // ---- BMP cover sniff -----------------------------------------------

    #[test]
    fn sniff_image_mime_bmp() {
        // BMP magic is "BM" followed by file size + reserved + offset.
        let mut buf = Vec::new();
        buf.extend_from_slice(b"BM");
        buf.extend_from_slice(&[0; 12]);
        assert_eq!(sniff_image_mime(&buf), "image/bmp");
    }
}
