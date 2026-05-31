// Native EPUB import path (Q1).
//
// Mirrors the JS-side parsing performed by foliate-js + DocumentLoader.open()
// on the import hot path:
//   - compute partialMD5 over the file (matches utils/md5.ts::partialMD5)
//   - read META-INF/container.xml -> rootfile (.opf)
//   - parse OPF metadata (title, authors, language, identifier, isbn,
//     publisher, published, description, subjects, calibre series/index)
//   - locate the cover image entry (manifest properties="cover-image" first,
//     then meta name="cover" -> manifest item id, then heuristic name match)
//   - return cover bytes as a base64 data URL so the JS side can persist it
//     through the existing Books/<hash>/cover.<ext> path
//
// Returned to JS via the parse_epub_metadata Tauri command. The JS side
// continues to drive sectioned reading at runtime, so this module is import-
// only and never opened on the reader hot path.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use percent_encoding::percent_decode;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;
use zip::ZipArchive;

// Cover constants + helpers + RawCoverImage type are shared with `mobi_parser`
// via `parser_common`, so a single tweak (e.g. raising the thumbnail target)
// applies to every native importer.
use crate::parser_common::{compute_partial_md5, maybe_resize_cover, RawCoverImage};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub identifier: Option<String>,
    pub isbn: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub description: Option<String>,
    pub subject: Vec<String>,
    pub series_name: Option<String>,
    pub series_index: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEpubMetadata {
    pub partial_md5: String,
    pub metadata: ParsedMetadata,
    /// base64 (no data: prefix); JS adds `data:<mime>;base64,` itself.
    pub cover_base64: Option<String>,
    pub cover_mime: Option<String>,
    /// Internal path within the epub zip; useful for diagnostics only.
    pub cover_zip_path: Option<String>,
}

#[tauri::command]
pub async fn parse_epub_metadata(file_path: String) -> Result<ParsedEpubMetadata, String> {
    // The body is CPU+IO bound: zip central-directory parse, OPF parse,
    // cover decode/resize/encode, base64. We must NOT run that on the Tauri
    // async runtime worker (the IPC dispatch thread), because then four
    // concurrent JS `invoke()`s queue up serially on a single worker.
    // Offload to the blocking pool, where they truly run in parallel.
    tauri::async_runtime::spawn_blocking(move || parse_epub_metadata_sync(&file_path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn parse_epub_metadata_sync(file_path: &str) -> Result<ParsedEpubMetadata, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("file not found: {file_path}"));
    }

    let partial_md5 = compute_partial_md5(path).map_err(|e| format!("partial_md5 failed: {e}"))?;

    let file = File::open(path).map_err(|e| format!("open failed: {e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("zip open failed: {e}"))?;

    let opf_path = read_rootfile_path(&mut zip).map_err(|e| format!("container.xml: {e}"))?;

    let opf_bytes =
        read_zip_entry(&mut zip, &opf_path).map_err(|e| format!("read opf {opf_path}: {e}"))?;
    let opf = parse_opf(&opf_bytes).map_err(|e| format!("parse opf: {e}"))?;

    let metadata = opf.metadata;

    let cover_zip_path = resolve_cover_path(&opf.manifest, &opf.cover_id, &opf_path);

    // Inline resize on the import hot path: at our target size (long edge
    // <= 512px, Triangle filter, JPEG q85) a release build keeps per-book
    // overhead well within budget, and avoiding a second on-disk pass keeps
    // the library grid sharp the moment import finishes. spawn_blocking
    // above already gives the 4 concurrent JS workers true parallelism.
    let (cover_base64, cover_mime) = if let Some(cover_path) = cover_zip_path.as_deref() {
        match read_zip_entry(&mut zip, cover_path) {
            Ok(bytes) => {
                let mime_hint = guess_image_mime(cover_path);
                let (out_bytes, out_mime) = maybe_resize_cover(bytes, mime_hint);
                let b64 = B64.encode(&out_bytes);
                (Some(b64), Some(out_mime))
            }
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    Ok(ParsedEpubMetadata {
        partial_md5,
        metadata,
        cover_base64,
        cover_mime,
        cover_zip_path,
    })
}

/// Extract the *original* (un-resized) cover bytes from an EPUB. Used by the
/// optional Android lock-screen wallpaper feature, where the user explicitly
/// asked for the full-resolution image rather than the on-disk thumbnail.
///
/// Returns the raw image bytes plus the MIME guessed from the manifest path.
/// If the EPUB has no cover this returns `Err`.
#[tauri::command]
pub async fn extract_epub_cover_full(file_path: String) -> Result<RawCoverImage, String> {
    tauri::async_runtime::spawn_blocking(move || extract_epub_cover_full_sync(&file_path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn extract_epub_cover_full_sync(file_path: &str) -> Result<RawCoverImage, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("file not found: {file_path}"));
    }
    let file = File::open(path).map_err(|e| format!("open failed: {e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("zip open failed: {e}"))?;
    let opf_path = read_rootfile_path(&mut zip).map_err(|e| format!("container.xml: {e}"))?;
    let opf_bytes =
        read_zip_entry(&mut zip, &opf_path).map_err(|e| format!("read opf {opf_path}: {e}"))?;
    let opf = parse_opf(&opf_bytes).map_err(|e| format!("parse opf: {e}"))?;
    let cover_zip_path = resolve_cover_path(&opf.manifest, &opf.cover_id, &opf_path)
        .ok_or_else(|| "no cover image in epub".to_string())?;
    let bytes = read_zip_entry(&mut zip, &cover_zip_path)
        .map_err(|e| format!("read cover {cover_zip_path}: {e}"))?;
    let mime = guess_image_mime(&cover_zip_path).to_string();
    Ok(RawCoverImage { bytes, mime })
}

// ---------------------------------------------------------------------------
// parse_epub_full: open hot path (replaces zip.js + foliate EPUB.init() prelude)
//
// On Tauri, the original JS-side `DocumentLoader.open()` for EPUB files spends
// ~1.5-1.7 s on:
//   1. @zip.js/zip.js BlobReader + ZipReader central-directory parse over the
//      whole file (the iOS WebView is markedly slower than Rust's `zip` crate
//      at this for large books);
//   2. unzip + read of META-INF/container.xml, the OPF, and the nav/ncx file;
//   3. DOMParser + parseNav/parseNCX in WebView XML stack.
//
// `parse_epub_full` collapses (1) and (2) into a single Rust call: it opens
// the zip once on the blocking pool, returns the OPF bytes, the nav/ncx bytes,
// the resolved nav/ncx zip paths, and the uncompressed-size of every manifest
// item keyed by its OPF-relative href. The JS side then:
//   - hands those bytes straight to foliate-js (DOMParser + Resources +
//     parseNav/parseNCX) — *no* re-implementation of CFI, TOC, or manifest
//     resolution happens in Rust, so cache compatibility (BookNav,
//     annotations, reading progress) is preserved bit-for-bit;
//   - looks up `getSize(href)` from the returned size map instead of opening
//     the zip again from JS;
//   - retains @zip.js/zip.js *only* for lazy `loadText`/`loadBlob` of section
//     bodies at runtime (the unavoidable WebView-side work — we can't shovel
//     each section over IPC without paying per-call overhead).
//
// Notes:
//   - We deliberately do NOT compute spine CFIs or build the TOC tree in
//     Rust. foliate-js's `CFI.fromElements` and `parseNav`/`parseNCX` walk
//     the live DOM with subtle filtering rules (cfi-inert, NodeFilter, etc.)
//     that we want to keep as the single source of truth across cache
//     versions. The OPF (and toc.ncx / nav.xhtml) is small XML — re-parsing
//     it once in the WebView is cheap; what was expensive was *finding* it
//     and unzipping it.
//   - Encryption isn't handled here (yet). Encrypted EPUBs fall back to the
//     foliate-js path; in practice Readest's EPUBs aren't encrypted.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEpubFull {
    /// partialMD5 — same algorithm as `parse_epub_metadata`. Returned here so
    /// open-hot-path callers don't need a second IPC round-trip just to hash.
    pub partial_md5: String,
    /// OPF zip path (e.g. "OEBPS/content.opf"). foliate-js needs this to
    /// resolve relative hrefs in the manifest.
    pub opf_path: String,
    /// Raw OPF bytes (XML). The JS side parses this with DOMParser and feeds
    /// it to foliate-js's `Resources` class — keeping CFI / manifest /
    /// metadata semantics 1:1 with the existing JS path.
    pub opf_bytes: Vec<u8>,
    /// Resolved nav.xhtml zip path, if the manifest declares
    /// `properties="nav"`. `None` when only an NCX or no TOC is present.
    pub nav_path: Option<String>,
    /// Raw nav.xhtml bytes when `nav_path` is `Some`.
    pub nav_bytes: Option<Vec<u8>>,
    /// Resolved toc.ncx zip path. Looked up via `<spine toc="...">` first,
    /// falling back to the first manifest item with media-type
    /// `application/x-dtbncx+xml`.
    pub ncx_path: Option<String>,
    /// Raw toc.ncx bytes when `ncx_path` is `Some`.
    pub ncx_bytes: Option<Vec<u8>>,
    /// Map: OPF-resolved href (e.g. "OEBPS/text/chapter1.xhtml") →
    /// uncompressedSize from the zip central directory. JS uses this for
    /// `getSize(item.href)` without re-opening the zip.
    pub sizes: std::collections::HashMap<String, u64>,
}

#[tauri::command]
pub async fn parse_epub_full(file_path: String) -> Result<ParsedEpubFull, String> {
    // Same threading rationale as parse_epub_metadata — keep IPC dispatch off
    // the CPU-bound zip/parse work so concurrent opens stay parallel.
    tauri::async_runtime::spawn_blocking(move || parse_epub_full_sync(&file_path))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn parse_epub_full_sync(file_path: &str) -> Result<ParsedEpubFull, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("file not found: {file_path}"));
    }

    let partial_md5 = compute_partial_md5(path).map_err(|e| format!("partial_md5 failed: {e}"))?;

    let file = File::open(path).map_err(|e| format!("open failed: {e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("zip open failed: {e}"))?;

    let opf_path = read_rootfile_path(&mut zip).map_err(|e| format!("container.xml: {e}"))?;

    let opf_bytes =
        read_zip_entry(&mut zip, &opf_path).map_err(|e| format!("read opf {opf_path}: {e}"))?;

    // Locate the nav and ncx targets without committing to a full OPF parse.
    // We need just three things from the OPF:
    //   - <manifest><item properties="...nav..."/> → href (EPUB3 nav doc)
    //   - <spine toc="ncx-id"> → href via manifest[id]
    //   - fallback: first <item media-type="application/x-dtbncx+xml"/>
    // A streaming pass with quick-xml gives us all three in one go and stays
    // O(OPF size) — measured at <1 ms even on big OPFs.
    let LocatedTocSources { nav_href, ncx_href } =
        locate_toc_sources(&opf_bytes).map_err(|e| format!("locate toc: {e}"))?;

    let nav_path = nav_href.map(|h| resolve_relative(&opf_path, &h));
    let ncx_path = ncx_href.map(|h| resolve_relative(&opf_path, &h));

    // Soft-fail on read errors: a missing nav/ncx doc isn't fatal; foliate-js
    // will fall back to NCX or to an empty TOC.
    let nav_bytes = nav_path
        .as_deref()
        .and_then(|p| read_zip_entry(&mut zip, p).ok());

    let ncx_bytes = ncx_path
        .as_deref()
        .and_then(|p| read_zip_entry(&mut zip, p).ok());

    // Build the size map from the central directory. We key by zip path
    // (OPF-relative href, normalized via resolve_relative on the JS side).
    // Walking the central directory in Rust is essentially free here — the
    // entries() iterator pulls from the cached metadata, no decompression.
    let mut sizes: std::collections::HashMap<String, u64> =
        std::collections::HashMap::with_capacity(zip.len());
    for i in 0..zip.len() {
        let entry = match zip.by_index_raw(i) {
            Ok(e) => e,
            // by_index_raw can fail on encrypted entries; skip silently.
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        sizes.insert(entry.name().to_string(), entry.size());
    }

    Ok(ParsedEpubFull {
        partial_md5,
        opf_path,
        opf_bytes,
        nav_path,
        nav_bytes,
        ncx_path,
        ncx_bytes,
        sizes,
    })
}

/// Hrefs found in the OPF, *as written* (not yet resolved against opf_path).
struct LocatedTocSources {
    nav_href: Option<String>,
    ncx_href: Option<String>,
}

/// Single-pass streaming scan of the OPF bytes to extract the nav document
/// href and the NCX href. Mirrors foliate-js Resources logic:
///
///   - nav: first manifest <item> whose `properties` contains the token "nav"
///   - ncx: <spine toc="..."> resolves to manifest[id]; otherwise the first
///     manifest <item> with media-type application/x-dtbncx+xml
fn locate_toc_sources(opf_bytes: &[u8]) -> Result<LocatedTocSources, String> {
    // We collect manifest items by id in a small map and remember the
    // <spine toc="..."> attribute (if any). We also short-circuit nav_href
    // as soon as we find a "nav" property.
    use std::collections::HashMap;

    let normalized = strip_xml_bom(opf_bytes);
    let mut reader = Reader::from_reader(normalized.as_ref());
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    #[derive(Default, Clone)]
    struct Item {
        href: String,
        media_type: String,
        properties: String,
    }

    let mut manifest: HashMap<String, Item> = HashMap::new();
    let mut spine_toc_id: Option<String> = None;
    let mut nav_href: Option<String> = None;
    let mut in_manifest = false;
    let mut in_spine = false;

    let process_item = |attrs: &[(Vec<u8>, Vec<u8>)],
                        manifest: &mut HashMap<String, Item>,
                        nav_href: &mut Option<String>| {
        let mut id = String::new();
        let mut item = Item::default();
        for (k, v) in attrs {
            match k.as_slice() {
                b"id" => id = String::from_utf8_lossy(v).into_owned(),
                b"href" => item.href = String::from_utf8_lossy(v).into_owned(),
                b"media-type" => item.media_type = String::from_utf8_lossy(v).into_owned(),
                b"properties" => item.properties = String::from_utf8_lossy(v).into_owned(),
                _ => {}
            }
        }
        if nav_href.is_none()
            && item.properties.split_ascii_whitespace().any(|p| p == "nav")
            && !item.href.is_empty()
        {
            *nav_href = Some(item.href.clone());
        }
        if !id.is_empty() {
            manifest.insert(id, item);
        }
    };

    let process_spine = |attrs: &[(Vec<u8>, Vec<u8>)], spine_toc_id: &mut Option<String>| {
        for (k, v) in attrs {
            if k.as_slice() == b"toc" {
                *spine_toc_id = Some(String::from_utf8_lossy(v).into_owned());
                break;
            }
        }
    };

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"manifest" {
                    in_manifest = true;
                } else if name == b"spine" {
                    in_spine = true;
                    let attrs: Vec<(Vec<u8>, Vec<u8>)> = e
                        .attributes()
                        .flatten()
                        .map(|a| (a.key.as_ref().to_vec(), a.value.into_owned()))
                        .collect();
                    process_spine(&attrs, &mut spine_toc_id);
                }
            }
            Ok(Event::Empty(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                let attrs: Vec<(Vec<u8>, Vec<u8>)> = e
                    .attributes()
                    .flatten()
                    .map(|a| (a.key.as_ref().to_vec(), a.value.into_owned()))
                    .collect();
                if in_manifest && name == b"item" {
                    process_item(&attrs, &mut manifest, &mut nav_href);
                } else if name == b"spine" {
                    // Self-closing <spine/> — unlikely but handle gracefully.
                    process_spine(&attrs, &mut spine_toc_id);
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"manifest" {
                    in_manifest = false;
                } else if name == b"spine" {
                    in_spine = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("xml: {e}")),
            _ => {}
        }
        buf.clear();
    }

    let _ = in_spine; // suppress unused (kept for symmetry / future use)

    // Resolve NCX:
    //   1. <spine toc="id"> → manifest[id].href
    //   2. fallback: any item with the NCX media-type
    let ncx_href = spine_toc_id
        .as_ref()
        .and_then(|id| manifest.get(id))
        .map(|it| it.href.clone())
        .or_else(|| {
            manifest
                .values()
                .find(|it| it.media_type == "application/x-dtbncx+xml")
                .map(|it| it.href.clone())
        });

    Ok(LocatedTocSources { nav_href, ncx_href })
}

// `maybe_resize_cover` is now defined in `parser_common`; the description
// below is retained here for navigation from EPUB-side call sites.
//
// Decode `bytes`, and:
//   - if max(width, height) <= COVER_MAX_LONG_EDGE, return the original
//     bytes verbatim (no decode/re-encode round-trip — preserves quality
//     and avoids needlessly re-compressing already-small covers, which
//     was point 2 of the user's brief);
//   - otherwise, resize so the long edge equals COVER_MAX_LONG_EDGE
//     (COVER_RESIZE_FILTER, aspect ratio preserved) and re-encode as
//     JPEG at COVER_JPEG_QUALITY.
//
// On any decode/encode failure we fall back to the original bytes + the
// caller-provided MIME so a malformed (but viewable) cover still makes it
// to disk.

// ---------------------------------------------------------------------------
// partial_md5: matches utils/md5.ts::partialMD5
//   step = 1024, size = 1024
//   for i in -1..=10:
//     start = step << (2*i)  (clamped to file end - size)
//     read 1024 bytes; feed into md5 incrementally
//
// (`compute_partial_md5` is now defined in `parser_common`; the comment
// block above is retained here for navigation from EPUB-side call sites.)
// ---------------------------------------------------------------------------

fn read_zip_entry<R: Read + Seek>(zip: &mut ZipArchive<R>, path: &str) -> Result<Vec<u8>, String> {
    // Two-pass lookup, mirroring what epub-rs does (archive.rs) and what
    // foliate-js does on the JS side: many EPUBs declare manifest hrefs that
    // are percent-encoded (e.g. "Text/My%20Chapter.xhtml" or CJK %E4%BB%96)
    // while the zip itself stores the raw decoded bytes — or vice versa.
    // We try the literal path first (the common case), then fall back to a
    // percent-decoded variant if it differs.
    if let Ok(bytes) = read_by_name(zip, path) {
        return Ok(bytes);
    }
    let decoded = percent_decode(path.as_bytes()).decode_utf8_lossy();
    if decoded.as_ref() != path {
        if let Ok(bytes) = read_by_name(zip, decoded.as_ref()) {
            return Ok(bytes);
        }
    }
    Err(format!("entry {path}: not found"))
}

fn read_by_name<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = zip
        .by_name(name)
        .map_err(|e| format!("entry {name}: {e}"))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .map_err(|e| format!("read {name}: {e}"))?;
    Ok(buf)
}

fn read_rootfile_path<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<String, String> {
    let bytes = read_zip_entry(zip, "META-INF/container.xml")?;
    let normalized = strip_xml_bom(&bytes);
    let mut reader = Reader::from_reader(normalized.as_ref());
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if local_name_eq(e.name().as_ref(), b"rootfile") {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            return Ok(String::from_utf8_lossy(&attr.value).into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("xml: {e}")),
            _ => {}
        }
        buf.clear();
    }
    Err("rootfile not found".into())
}

// ---------------------------------------------------------------------------
// OPF parsing
// ---------------------------------------------------------------------------
#[derive(Debug, Default)]
struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

/// A top-level `<meta property="..." id="...">value</meta>` element from the
/// EPUB3 metadata block. We collect these alongside their refines so that
/// `belongs-to-collection` series can be resolved after the full OPF has
/// been streamed.
#[derive(Debug, Default)]
struct TopMeta {
    property: String,
    value: String,
    /// The `id` attribute on this element, if present. Other meta elements
    /// may target it via `refines="#id"`.
    id: Option<String>,
}

#[derive(Debug, Default)]
struct Opf {
    metadata: ParsedMetadata,
    /// id -> item
    manifest: std::collections::HashMap<String, ManifestItem>,
    /// id of cover image as declared by <meta name="cover" content="..."/>
    cover_id: Option<String>,
    /// EPUB3 top-level <meta property=... id=...> elements (used for
    /// `belongs-to-collection`).
    top_metas: Vec<TopMeta>,
    /// EPUB3 refines chain: target id -> [(property, value), ...].
    /// Populated from <meta refines="#id" property="...">value</meta>.
    refines: std::collections::HashMap<String, Vec<(String, String)>>,
}

fn parse_opf(bytes: &[u8]) -> Result<Opf, String> {
    let normalized = strip_xml_bom(bytes);
    let mut reader = Reader::from_reader(normalized.as_ref());
    reader.config_mut().trim_text(true);
    let mut opf = Opf::default();
    let mut buf = Vec::new();

    let mut stack: Vec<OpenNode> = Vec::new();
    let mut in_metadata = false;
    let mut in_manifest = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name_owned = local_name(e.name().as_ref()).to_vec();
                if name_owned == b"metadata" {
                    in_metadata = true;
                } else if name_owned == b"manifest" {
                    in_manifest = true;
                }
                let mut open = OpenNode {
                    name: name_owned,
                    text: String::new(),
                    attrs: Vec::new(),
                };
                for attr in e.attributes().flatten() {
                    open.attrs
                        .push((attr.key.as_ref().to_vec(), attr.value.into_owned()));
                }
                stack.push(open);
            }
            Ok(Event::Empty(e)) => {
                let name_owned = local_name(e.name().as_ref()).to_vec();
                let mut attrs: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
                for attr in e.attributes().flatten() {
                    attrs.push((attr.key.as_ref().to_vec(), attr.value.into_owned()));
                }
                if in_manifest && name_owned == b"item" {
                    let mut id = String::new();
                    let mut item = ManifestItem::default();
                    for (k, v) in &attrs {
                        match k.as_slice() {
                            b"id" => id = String::from_utf8_lossy(v).into_owned(),
                            b"href" => item.href = String::from_utf8_lossy(v).into_owned(),
                            b"media-type" => {
                                item.media_type = String::from_utf8_lossy(v).into_owned()
                            }
                            b"properties" => {
                                item.properties = String::from_utf8_lossy(v).into_owned()
                            }
                            _ => {}
                        }
                    }
                    if !id.is_empty() {
                        opf.manifest.insert(id, item);
                    }
                }
                if in_metadata && name_owned == b"meta" {
                    // Self-closing <meta /> only carries the legacy
                    // name/content pair (EPUB3 property metas always wrap a
                    // text node). Handle it inline.
                    handle_meta(&attrs, "", &mut opf);
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(top) = stack.last_mut() {
                    if let Ok(s) = t.unescape() {
                        top.text.push_str(&s);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_vec();
                if name == b"metadata" {
                    in_metadata = false;
                } else if name == b"manifest" {
                    in_manifest = false;
                }
                if let Some(open) = stack.pop() {
                    if in_metadata || name == b"metadata" {
                        absorb_metadata_element(&open, &mut opf.metadata);
                    }
                    if name == b"meta" {
                        // Start+text+End form. Pass the captured text along
                        // so EPUB3 `<meta property=...>VAL</meta>` and
                        // refines chains work too.
                        handle_meta(&open.attrs, &open.text, &mut opf);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("xml: {e}")),
            _ => {}
        }
        buf.clear();
    }

    apply_epub3_collection(&mut opf);

    Ok(opf)
}

/// Walk the EPUB3 `belongs-to-collection` graph and lift a `series` entry
/// into `metadata.series_name` / `metadata.series_index`. Schema (EPUB3.2):
///
///   <meta property="belongs-to-collection" id="c01">My Series</meta>
///   <meta refines="#c01" property="collection-type">series</meta>
///   <meta refines="#c01" property="group-position">3</meta>
///
/// We only adopt the value when no calibre legacy entry already filled it
/// in (calibre wins by virtue of running first in `handle_meta`), so that
/// hand-crafted EPUBs without a `<meta name="calibre:series">` still get
/// proper series display.
fn apply_epub3_collection(opf: &mut Opf) {
    if opf.metadata.series_name.is_some() && opf.metadata.series_index.is_some() {
        return;
    }
    for top in &opf.top_metas {
        if top.property != "belongs-to-collection" {
            continue;
        }
        let id = match &top.id {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let refines = match opf.refines.get(id) {
            Some(v) => v,
            None => continue,
        };
        // We only care about series-typed collections; sets, etc. are
        // intentionally ignored to match the JS importer's expectations.
        let is_series = refines
            .iter()
            .any(|(p, v)| p == "collection-type" && v.eq_ignore_ascii_case("series"));
        if !is_series {
            continue;
        }
        if opf.metadata.series_name.is_none() && !top.value.is_empty() {
            opf.metadata.series_name = Some(top.value.clone());
        }
        if opf.metadata.series_index.is_none() {
            if let Some((_, v)) = refines.iter().find(|(p, _)| p == "group-position") {
                if let Ok(f) = v.parse::<f64>() {
                    opf.metadata.series_index = Some(f);
                }
            }
        }
        // Stop at the first matching series collection — multi-series
        // EPUBs are rare and the JS-side metadata only stores one.
        break;
    }
}

fn absorb_metadata_element(open: &OpenNode, m: &mut ParsedMetadata) {
    let name = open.name.as_slice();
    let text = open.text.trim().to_string();
    match name {
        b"title" => {
            if m.title.is_none() && !text.is_empty() {
                m.title = Some(text);
            }
        }
        b"creator" => {
            if !text.is_empty() {
                m.authors.push(text);
            }
        }
        b"language" => {
            if m.language.is_none() && !text.is_empty() {
                m.language = Some(text);
            }
        }
        b"identifier" => {
            // Detect ISBN via opf:scheme attribute.
            let mut is_isbn = false;
            for (k, v) in &open.attrs {
                let kk = k.as_slice();
                if (kk == b"scheme" || ends_with(kk, b":scheme"))
                    && v.as_slice().eq_ignore_ascii_case(b"ISBN")
                {
                    is_isbn = true;
                }
            }
            if !text.is_empty() {
                if is_isbn && m.isbn.is_none() {
                    m.isbn = Some(text.clone());
                }
                if m.identifier.is_none() {
                    m.identifier = Some(text);
                }
            }
        }
        b"publisher" => {
            if m.publisher.is_none() && !text.is_empty() {
                m.publisher = Some(text);
            }
        }
        b"date" => {
            if m.published.is_none() && !text.is_empty() {
                m.published = Some(text);
            }
        }
        b"description" => {
            if m.description.is_none() && !text.is_empty() {
                m.description = Some(text);
            }
        }
        b"subject" if !text.is_empty() => {
            m.subject.push(text);
        }
        _ => {}
    }
}

/// Process a `<meta>` element inside `<metadata>`. Two distinct schemas
/// exist; we accept both:
///
/// 1. **OPF2 legacy** — `<meta name="cover" content="cover-id"/>` and the
///    calibre-private `name="calibre:series"` / `name="calibre:series_index"`
///    pairs. The text body is empty.
///
/// 2. **EPUB3 properties** — `<meta property="dcterms:foo" id="bar"
///    refines="#target">value</meta>`. `text` carries the value. Three
///    sub-cases:
///       - `refines="#id"` → record into `opf.refines[id]` for later
///         resolution (`belongs-to-collection`, `creator role`, etc.).
///       - no `refines`, but `id` present → `top_metas`. Used by
///         `apply_epub3_collection`.
///       - bare `<meta property="dcterms:..."/>` with neither id nor
///         refines: only relevant if it duplicates a missing `dc:*`
///         element; we lift `dcterms:title` / `dcterms:creator` etc. as
///         a last-resort fallback.
fn handle_meta(attrs: &[(Vec<u8>, Vec<u8>)], text: &str, opf: &mut Opf) {
    let mut name = None::<&[u8]>;
    let mut content = None::<&[u8]>;
    let mut property = None::<&[u8]>;
    let mut refines = None::<&[u8]>;
    let mut id = None::<&[u8]>;
    for (k, v) in attrs {
        match k.as_slice() {
            b"name" => name = Some(v.as_slice()),
            b"content" => content = Some(v.as_slice()),
            b"property" => property = Some(v.as_slice()),
            b"refines" => refines = Some(v.as_slice()),
            b"id" => id = Some(v.as_slice()),
            _ => {}
        }
    }

    // Path 1: legacy <meta name=... content=...> pair.
    if let (Some(n), Some(c)) = (name, content) {
        let nl = ascii_lower(n);
        let cs = String::from_utf8_lossy(c).into_owned();
        match nl.as_slice() {
            b"cover" => {
                if opf.cover_id.is_none() {
                    opf.cover_id = Some(cs);
                }
            }
            b"calibre:series" => {
                if opf.metadata.series_name.is_none() {
                    opf.metadata.series_name = Some(cs);
                }
            }
            b"calibre:series_index" if opf.metadata.series_index.is_none() => {
                if let Ok(f) = cs.parse::<f64>() {
                    opf.metadata.series_index = Some(f);
                }
            }
            _ => {}
        }
    }

    // Path 2: EPUB3 property meta. The text body is the value.
    if let Some(p) = property {
        let prop = String::from_utf8_lossy(p).into_owned();
        let value = text.trim().to_string();

        if let Some(target) = refines {
            // Strip leading `#` per spec.
            let raw = String::from_utf8_lossy(target);
            let target_id = raw.strip_prefix('#').unwrap_or(&raw).to_string();
            if !target_id.is_empty() {
                opf.refines
                    .entry(target_id)
                    .or_default()
                    .push((prop, value));
            }
            return;
        }

        // Top-level property meta. Stash for `apply_epub3_collection` if it
        // has an id, otherwise treat as a fallback metadata source.
        if id.is_some() && !value.is_empty() {
            let id_str = id
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .filter(|s| !s.is_empty());
            opf.top_metas.push(TopMeta {
                property: prop.clone(),
                value: value.clone(),
                id: id_str,
            });
        }

        // Last-resort fallback: a `<meta property="dcterms:title">` etc.
        // when the publisher omitted the regular `<dc:title>` element. We
        // never overwrite a value that's already populated.
        if !value.is_empty() {
            // Allow either bare `dcterms:title` or `title` on the property.
            let local = prop.rsplit(':').next().unwrap_or(&prop);
            match local {
                "title" => {
                    if opf.metadata.title.is_none() {
                        opf.metadata.title = Some(value);
                    }
                }
                "creator" => opf.metadata.authors.push(value),
                "language" => {
                    if opf.metadata.language.is_none() {
                        opf.metadata.language = Some(value);
                    }
                }
                "publisher" => {
                    if opf.metadata.publisher.is_none() {
                        opf.metadata.publisher = Some(value);
                    }
                }
                "description" => {
                    if opf.metadata.description.is_none() {
                        opf.metadata.description = Some(value);
                    }
                }
                // Only `dc:date` / `dcterms:date` is the publication date.
                // `dcterms:modified` is the package last-modified timestamp —
                // foliate-js surfaces it as a separate `modified` field and
                // leaves `published` empty, so mapping it here would diverge
                // from the JS parser and show a bogus publication date for
                // EPUB3 books that only carry the mandatory `dcterms:modified`.
                "date" => {
                    if opf.metadata.published.is_none() {
                        opf.metadata.published = Some(value);
                    }
                }
                "subject" => opf.metadata.subject.push(value),
                "identifier" if opf.metadata.identifier.is_none() => {
                    opf.metadata.identifier = Some(value);
                }
                _ => {}
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Cover resolution
// ---------------------------------------------------------------------------
fn resolve_cover_path(
    manifest: &std::collections::HashMap<String, ManifestItem>,
    cover_id: &Option<String>,
    opf_path: &str,
) -> Option<String> {
    // 1) properties="cover-image" (EPUB3)
    for item in manifest.values() {
        if item
            .properties
            .split_ascii_whitespace()
            .any(|p| p == "cover-image")
        {
            return Some(resolve_relative(opf_path, &item.href));
        }
    }
    // 2) <meta name="cover" content="<id>"/> -> manifest[id] (EPUB2)
    if let Some(id) = cover_id {
        if let Some(item) = manifest.get(id) {
            return Some(resolve_relative(opf_path, &item.href));
        }
    }
    // 3) Heuristic: image item whose id/href contains "cover".
    //
    // Two-pass strategy:
    //   pass 1 (preferred): raster images only (skip image/svg+xml, since SVG
    //                       items are usually the cover *page* wrapping a real
    //                       raster, not the cover image itself); also skip any
    //                       item carrying the `nav` property as a defensive
    //                       guard (spec puts `nav` on xhtml, but properties is
    //                       a token list and we don't want to ever pick it).
    //   pass 2 (fallback): if pass 1 found nothing (e.g. the EPUB only ships
    //                      SVG covers), allow SVG so we don't lose covers on
    //                      odd-but-valid EPUBs. `nav` is still excluded.
    fn pick(
        manifest: &std::collections::HashMap<String, ManifestItem>,
        allow_svg: bool,
    ) -> Option<&ManifestItem> {
        let mut best: Option<&ManifestItem> = None;
        for item in manifest.values() {
            if !item.media_type.starts_with("image/") {
                continue;
            }
            if !allow_svg && item.media_type == "image/svg+xml" {
                continue;
            }
            if item.properties.split_ascii_whitespace().any(|p| p == "nav") {
                continue;
            }
            let href_l = item.href.to_ascii_lowercase();
            if href_l.contains("cover") {
                return Some(item);
            }
            if best.is_none() {
                best = Some(item);
            }
        }
        best
    }

    let chosen = pick(manifest, false).or_else(|| pick(manifest, true));
    chosen.map(|item| resolve_relative(opf_path, &item.href))
}

fn resolve_relative(opf_path: &str, href: &str) -> String {
    // Strip query/fragment that occasionally appear in manifest hrefs.
    let href = href.split(['?', '#']).next().unwrap_or(href);
    let dir = match opf_path.rfind('/') {
        Some(idx) => &opf_path[..idx],
        None => "",
    };
    let joined = if dir.is_empty() {
        href.to_string()
    } else {
        format!("{dir}/{href}")
    };
    normalize_zip_path(&joined)
}

fn normalize_zip_path(p: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out.join("/")
}

fn guess_image_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        // Default for .jpg / .jpeg and any other extension; the JS importer
        // also assumes JPEG when the manifest media-type is missing/unknown.
        "image/jpeg"
    }
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/// Normalize the byte payload of an XML document for `quick-xml`:
///
///   - strip a leading UTF-8 BOM (EF BB BF) — quick-xml otherwise emits a
///     spurious `Text` event before the prolog and some declarations fail
///     to parse;
///   - if the document begins with a UTF-16 BOM (FE FF or FF FE), transcode
///     to UTF-8 lossily so the rest of our pipeline can keep treating bytes
///     as UTF-8. Real-world EPUBs are very rarely UTF-16 but a handful of
///     publisher tools (notably old Adobe InDesign exports) still emit it.
///
/// Returns a `Cow` so the common (UTF-8, no BOM) case stays zero-copy.
fn strip_xml_bom(bytes: &[u8]) -> Cow<'_, [u8]> {
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        return Cow::Borrowed(&bytes[3..]);
    }
    if bytes.len() >= 2 {
        let big_endian = bytes[0] == 0xFE && bytes[1] == 0xFF;
        let little_endian = bytes[0] == 0xFF && bytes[1] == 0xFE;
        if big_endian || little_endian {
            let body = &bytes[2..];
            // chunks_exact silently drops a trailing odd byte, which is what
            // we want — a malformed UTF-16 stream still produces a best-
            // effort UTF-8 transcoding rather than failing the whole import.
            let units: Vec<u16> = body
                .chunks_exact(2)
                .map(|c| {
                    if big_endian {
                        u16::from_be_bytes([c[0], c[1]])
                    } else {
                        u16::from_le_bytes([c[0], c[1]])
                    }
                })
                .collect();
            let s = String::from_utf16_lossy(&units);
            return Cow::Owned(s.into_bytes());
        }
    }
    Cow::Borrowed(bytes)
}

fn local_name(qname: &[u8]) -> &[u8] {
    match qname.iter().rposition(|b| *b == b':') {
        Some(idx) => &qname[idx + 1..],
        None => qname,
    }
}

fn local_name_eq(qname: &[u8], local: &[u8]) -> bool {
    local_name(qname) == local
}

fn ends_with(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len() && &haystack[haystack.len() - needle.len()..] == needle
}

fn ascii_lower(b: &[u8]) -> Vec<u8> {
    b.iter().map(|c| c.to_ascii_lowercase()).collect()
}

struct OpenNode {
    name: Vec<u8>,
    text: String,
    attrs: Vec<(Vec<u8>, Vec<u8>)>,
}

#[cfg(test)]
mod tests {
    use super::*;
    // Pulled in here (rather than at module scope) because the production
    // code now consumes the cover-resize / partial-md5 helpers through
    // `parser_common`; the tests still need `image::*`, `Cursor`, `Md5`
    // and friends to synthesise fixtures and cross-check the hash.
    use crate::parser_common::COVER_MAX_LONG_EDGE;
    use image::GenericImageView;
    use md5::{Digest, Md5};
    use std::collections::HashMap;
    use std::io::Cursor;

    #[test]
    fn parses_minimal_opf() {
        let xml = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>The Great Gatsby</dc:title>
    <dc:creator>F. Scott Fitzgerald</dc:creator>
    <dc:creator>Ghost Writer</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier opf:scheme="ISBN">9780743273565</dc:identifier>
    <dc:publisher>Scribner</dc:publisher>
    <dc:date>1925-04-10</dc:date>
    <dc:description>A novel.</dc:description>
    <dc:subject>Fiction</dc:subject>
    <dc:subject>Classics</dc:subject>
    <meta name="cover" content="cover-img"/>
    <meta name="calibre:series" content="Jazz Age"/>
    <meta name="calibre:series_index" content="1.5"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>"#;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.title.as_deref(), Some("The Great Gatsby"));
        assert_eq!(
            opf.metadata.authors,
            vec![
                "F. Scott Fitzgerald".to_string(),
                "Ghost Writer".to_string()
            ]
        );
        assert_eq!(opf.metadata.language.as_deref(), Some("en"));
        assert_eq!(opf.metadata.identifier.as_deref(), Some("9780743273565"));
        assert_eq!(opf.metadata.isbn.as_deref(), Some("9780743273565"));
        assert_eq!(opf.metadata.publisher.as_deref(), Some("Scribner"));
        assert_eq!(opf.metadata.published.as_deref(), Some("1925-04-10"));
        assert_eq!(opf.metadata.description.as_deref(), Some("A novel."));
        assert_eq!(
            opf.metadata.subject,
            vec!["Fiction".to_string(), "Classics".to_string()]
        );
        assert_eq!(opf.metadata.series_name.as_deref(), Some("Jazz Age"));
        assert_eq!(opf.metadata.series_index, Some(1.5));
        assert_eq!(opf.cover_id.as_deref(), Some("cover-img"));
        assert!(opf.manifest.contains_key("cover-img"));
        assert!(opf.manifest.contains_key("ch1"));
    }

    // `dcterms:modified` is the package last-modified timestamp, not the
    // publication date. foliate-js surfaces it as a separate `modified` field
    // and leaves `published` empty; mapping it into `published` would diverge
    // from the JS parser and show a bogus "Published" date for EPUB3 books
    // that only carry the mandatory `dcterms:modified` meta.
    #[test]
    fn dcterms_modified_does_not_populate_published() {
        let xml = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Modified Only</dc:title>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest/>
</package>"#;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.published, None);
    }

    // A real `<dc:date>` still maps to `published`, matching foliate-js.
    #[test]
    fn dc_date_populates_published() {
        let xml = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Dated</dc:title>
    <dc:date>1897</dc:date>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest/>
</package>"#;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.published.as_deref(), Some("1897"));
    }

    #[test]
    fn cover_resolution_prefers_epub3_properties() {
        let mut manifest = HashMap::new();
        manifest.insert(
            "img1".into(),
            ManifestItem {
                href: "img/foo.jpg".into(),
                media_type: "image/jpeg".into(),
                properties: "cover-image".into(),
            },
        );
        manifest.insert(
            "img2".into(),
            ManifestItem {
                href: "img/bar.jpg".into(),
                media_type: "image/jpeg".into(),
                properties: String::new(),
            },
        );
        let p = resolve_cover_path(&manifest, &None, "OEBPS/content.opf").unwrap();
        assert_eq!(p, "OEBPS/img/foo.jpg");
    }

    #[test]
    fn cover_resolution_falls_back_to_meta_cover() {
        let mut manifest = HashMap::new();
        manifest.insert(
            "cov".into(),
            ManifestItem {
                href: "images/c.png".into(),
                media_type: "image/png".into(),
                properties: String::new(),
            },
        );
        manifest.insert(
            "other".into(),
            ManifestItem {
                href: "images/o.png".into(),
                media_type: "image/png".into(),
                properties: String::new(),
            },
        );
        let p = resolve_cover_path(&manifest, &Some("cov".into()), "content.opf").unwrap();
        assert_eq!(p, "images/c.png");
    }

    #[test]
    fn cover_heuristic_skips_svg_when_raster_available() {
        // Without `properties=cover-image` and without `<meta name=cover>`, an
        // SVG sitting next to a JPEG must NOT be picked: SVGs in EPUBs are
        // typically the cover *page* (a wrapper xhtml/svg), not the actual
        // cover image.
        let mut manifest = HashMap::new();
        manifest.insert(
            "cov-svg".into(),
            ManifestItem {
                href: "images/cover.svg".into(),
                media_type: "image/svg+xml".into(),
                properties: String::new(),
            },
        );
        manifest.insert(
            "cov-jpg".into(),
            ManifestItem {
                href: "images/cover.jpg".into(),
                media_type: "image/jpeg".into(),
                properties: String::new(),
            },
        );
        let p = resolve_cover_path(&manifest, &None, "OEBPS/content.opf").unwrap();
        assert_eq!(p, "OEBPS/images/cover.jpg");
    }

    #[test]
    fn cover_heuristic_falls_back_to_svg_when_only_svg_present() {
        // Edge-case EPUBs that ship only an SVG cover must still resolve a
        // cover path — pass-2 of the heuristic re-runs with SVG allowed.
        let mut manifest = HashMap::new();
        manifest.insert(
            "cov-svg".into(),
            ManifestItem {
                href: "images/cover.svg".into(),
                media_type: "image/svg+xml".into(),
                properties: String::new(),
            },
        );
        manifest.insert(
            "ch1".into(),
            ManifestItem {
                href: "text/ch1.xhtml".into(),
                media_type: "application/xhtml+xml".into(),
                properties: String::new(),
            },
        );
        let p = resolve_cover_path(&manifest, &None, "OEBPS/content.opf").unwrap();
        assert_eq!(p, "OEBPS/images/cover.svg");
    }

    #[test]
    fn cover_heuristic_skips_items_with_nav_property() {
        // Defensive: even though `nav` belongs on xhtml per spec, properties
        // is a token list and we never want to pick a nav-tagged item as a
        // cover. The non-nav image must win.
        let mut manifest = HashMap::new();
        manifest.insert(
            "weird-nav".into(),
            ManifestItem {
                href: "images/cover.jpg".into(),
                media_type: "image/jpeg".into(),
                properties: "nav".into(),
            },
        );
        manifest.insert(
            "real".into(),
            ManifestItem {
                href: "images/other.jpg".into(),
                media_type: "image/jpeg".into(),
                properties: String::new(),
            },
        );
        let p = resolve_cover_path(&manifest, &None, "OEBPS/content.opf").unwrap();
        assert_eq!(p, "OEBPS/images/other.jpg");
    }

    #[test]
    fn normalize_zip_path_strips_dotdot() {
        assert_eq!(normalize_zip_path("OEBPS/../images/x.png"), "images/x.png");
        assert_eq!(normalize_zip_path("OEBPS/./x.png"), "OEBPS/x.png");
        assert_eq!(normalize_zip_path("a//b/c"), "a/b/c");
    }

    #[test]
    fn resolve_relative_handles_query_and_fragment() {
        let p = resolve_relative("OEBPS/content.opf", "images/c.png?foo=1#bar");
        assert_eq!(p, "OEBPS/images/c.png");
    }

    #[test]
    fn guess_image_mime_known_types() {
        assert_eq!(guess_image_mime("a.PNG"), "image/png");
        assert_eq!(guess_image_mime("a.jpg"), "image/jpeg");
        assert_eq!(guess_image_mime("a.JPEG"), "image/jpeg");
        assert_eq!(guess_image_mime("a.webp"), "image/webp");
        assert_eq!(guess_image_mime("a.gif"), "image/gif");
        assert_eq!(guess_image_mime("a.svg"), "image/svg+xml");
        assert_eq!(guess_image_mime("a"), "image/jpeg");
    }

    #[test]
    fn local_name_strips_namespace() {
        assert_eq!(local_name(b"dc:title"), b"title");
        assert_eq!(local_name(b"title"), b"title");
        assert_eq!(local_name(b"a:b:c"), b"c");
    }

    #[test]
    fn partial_md5_short_file_matches_js_reference() {
        // For a tiny 11-byte file the JS reference behaves as follows:
        //   i = -1: rawShift = 1024 << -2 -> 1024 << 30 (JS masks operand
        //           to 5 bits, then truncates to i32, yielding 0)
        //           start = min(11, 0) = 0, end = min(1024, 11) = 11 -> read
        //   i = 0:  rawShift = 1024, start = min(11, 1024) = 11 -> break
        // So the resulting hash is md5("hello world").
        let dir = std::env::temp_dir();
        let path = dir.join("readest-epub-parser-test.bin");
        std::fs::write(&path, b"hello world").unwrap();
        let hash = compute_partial_md5(&path).unwrap();
        // Pre-computed: md5("hello world") = 5eb63bbbe01eeed093cb22bb8f5acdc3
        assert_eq!(hash, "5eb63bbbe01eeed093cb22bb8f5acdc3");
        let _ = std::fs::remove_file(path);
    }

    fn make_test_png(width: u32, height: u32) -> Vec<u8> {
        // Build a tiny in-memory PNG with a 2x2 checker pattern, then scale
        // up via image::DynamicImage to get the requested size. This avoids
        // pulling extra fixture files into the repo.
        let mut img = image::RgbImage::new(width, height);
        for (x, y, px) in img.enumerate_pixels_mut() {
            let on = ((x / 4) + (y / 4)) % 2 == 0;
            *px = if on {
                image::Rgb([200, 50, 50])
            } else {
                image::Rgb([20, 20, 200])
            };
        }
        let mut out = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn maybe_resize_cover_keeps_small_image_unchanged() {
        // 256x256 < 512: no decode/re-encode, byte-identical, MIME passthrough.
        let png = make_test_png(256, 256);
        let original = png.clone();
        let (out, mime) = maybe_resize_cover(png, "image/png");
        assert_eq!(out, original, "small images must be returned verbatim");
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn maybe_resize_cover_keeps_image_at_threshold() {
        // 512x512 == threshold: still passes through.
        let png = make_test_png(512, 512);
        let original = png.clone();
        let (out, mime) = maybe_resize_cover(png, "image/jpeg");
        assert_eq!(out, original);
        assert_eq!(mime, "image/jpeg");
    }

    #[test]
    fn maybe_resize_cover_downscales_large_image() {
        // 1500x1000: long edge 1500 -> 512, short edge proportional.
        // After encoding we re-decode to assert the dimensions and MIME.
        let png = make_test_png(1500, 1000);
        let (out, mime) = maybe_resize_cover(png, "image/png");
        assert_eq!(mime, "image/jpeg");
        let decoded = image::load_from_memory(&out).expect("re-decodes");
        let (w, h) = decoded.dimensions();
        assert!(w <= COVER_MAX_LONG_EDGE && h <= COVER_MAX_LONG_EDGE);
        assert!(
            w == COVER_MAX_LONG_EDGE || h == COVER_MAX_LONG_EDGE,
            "long edge should hit 512 exactly, got ({w},{h})"
        );
        // Aspect ratio (3:2) should be preserved within rounding tolerance.
        let ratio = w as f64 / h as f64;
        assert!((ratio - 1.5).abs() < 0.02, "aspect ratio drifted: {ratio}");
        // Re-encoded JPEG should be drastically smaller than the source PNG.
        assert!(
            out.len() < 200 * 1024,
            "expected <200 KiB, got {}",
            out.len()
        );
    }

    #[test]
    fn maybe_resize_cover_preserves_aspect_for_tall_image() {
        // 800x2000 (aspect 0.4): tall edge -> 512, width ~205.
        let png = make_test_png(800, 2000);
        let (out, mime) = maybe_resize_cover(png, "image/png");
        assert_eq!(mime, "image/jpeg");
        let (w, h) = image::load_from_memory(&out).unwrap().dimensions();
        assert_eq!(h, COVER_MAX_LONG_EDGE);
        assert!(w < h, "tall image should stay tall");
        let ratio = w as f64 / h as f64;
        assert!((ratio - 0.4).abs() < 0.02, "aspect drifted: {ratio}");
    }

    #[test]
    fn maybe_resize_cover_returns_input_on_decode_failure() {
        // Garbage bytes are not a valid image; we should fall back to the
        // original blob + the caller-supplied MIME rather than panic.
        let junk = b"not an image".to_vec();
        let (out, mime) = maybe_resize_cover(junk.clone(), "image/png");
        assert_eq!(out, junk);
        assert_eq!(mime, "image/png");
    }

    #[test]
    fn parses_epub3_belongs_to_collection_series() {
        // EPUB3 schema: top-level meta carries the series name with id="c01",
        // refines chain provides collection-type=series + group-position=2.
        // (Use ## delimiter because the XML body contains `"#` from
        //  `refines="#c01"`, which would otherwise close a single-`#` raw
        //  string early.)
        let xml = br##"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Book Two</dc:title>
    <meta property="belongs-to-collection" id="c01">Foundation Saga</meta>
    <meta refines="#c01" property="collection-type">series</meta>
    <meta refines="#c01" property="group-position">2</meta>
  </metadata>
  <manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest>
</package>"##;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.series_name.as_deref(), Some("Foundation Saga"));
        assert_eq!(opf.metadata.series_index, Some(2.0));
    }

    #[test]
    fn calibre_legacy_series_wins_over_epub3_collection() {
        // When both <meta name="calibre:series"> and the EPUB3
        // belongs-to-collection chain are present, calibre wins (it runs
        // first inside `handle_meta`, which mirrors what the JS importer
        // assumes from real-world calibre exports).
        let xml = br##"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>T</dc:title>
    <meta name="calibre:series" content="Calibre Series"/>
    <meta name="calibre:series_index" content="3"/>
    <meta property="belongs-to-collection" id="c01">EPUB3 Series</meta>
    <meta refines="#c01" property="collection-type">series</meta>
    <meta refines="#c01" property="group-position">99</meta>
  </metadata>
  <manifest/>
</package>"##;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.series_name.as_deref(), Some("Calibre Series"));
        assert_eq!(opf.metadata.series_index, Some(3.0));
    }

    #[test]
    fn epub3_collection_set_type_is_ignored() {
        // Only collection-type="series" should adopt the value into
        // metadata.series_*. Sets and other types are intentionally skipped
        // so that an "Omnibus Set" doesn't masquerade as a series.
        let xml = br##"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>T</dc:title>
    <meta property="belongs-to-collection" id="c01">Boxed Set</meta>
    <meta refines="#c01" property="collection-type">set</meta>
  </metadata>
  <manifest/>
</package>"##;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.series_name, None);
        assert_eq!(opf.metadata.series_index, None);
    }

    #[test]
    fn dcterms_property_meta_is_used_as_fallback() {
        // Some EPUB3 publishers omit <dc:title> entirely and rely on
        // <meta property="dcterms:title">. Verify we lift it as a fallback
        // when no dc:* element provided the value.
        let xml = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <meta property="dcterms:title">Fallback Title</meta>
    <meta property="dcterms:language">fr</meta>
  </metadata>
  <manifest/>
</package>"#;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.title.as_deref(), Some("Fallback Title"));
        assert_eq!(opf.metadata.language.as_deref(), Some("fr"));
    }

    #[test]
    fn dc_title_wins_over_dcterms_property_meta() {
        // When both forms exist, the canonical <dc:title> wins. The
        // dcterms property meta is only a fallback for missing fields.
        let xml = br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Real Title</dc:title>
    <meta property="dcterms:title">Other Title</meta>
  </metadata>
  <manifest/>
</package>"#;
        let opf = parse_opf(xml).expect("opf parses");
        assert_eq!(opf.metadata.title.as_deref(), Some("Real Title"));
    }

    #[test]
    fn strip_xml_bom_handles_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(b"<root/>");
        let stripped = strip_xml_bom(&bytes);
        assert_eq!(stripped.as_ref(), b"<root/>");
    }

    #[test]
    fn strip_xml_bom_passthrough_when_no_bom() {
        let bytes = b"<root/>";
        let stripped = strip_xml_bom(bytes);
        // Cow::Borrowed → no allocation, same pointer.
        assert!(matches!(stripped, Cow::Borrowed(_)));
        assert_eq!(stripped.as_ref(), b"<root/>");
    }

    #[test]
    fn strip_xml_bom_decodes_utf16_le() {
        // "<a/>" in UTF-16 little-endian, with FF FE BOM.
        let mut bytes = vec![0xFF, 0xFE];
        for ch in "<a/>".encode_utf16() {
            bytes.extend_from_slice(&ch.to_le_bytes());
        }
        let stripped = strip_xml_bom(&bytes);
        assert_eq!(stripped.as_ref(), b"<a/>");
    }

    #[test]
    fn strip_xml_bom_decodes_utf16_be() {
        // "<a/>" in UTF-16 big-endian, with FE FF BOM.
        let mut bytes = vec![0xFE, 0xFF];
        for ch in "<a/>".encode_utf16() {
            bytes.extend_from_slice(&ch.to_be_bytes());
        }
        let stripped = strip_xml_bom(&bytes);
        assert_eq!(stripped.as_ref(), b"<a/>");
    }

    #[test]
    fn parse_opf_tolerates_utf8_bom() {
        // Real-world EPUBs from some Windows toolchains ship the OPF with a
        // UTF-8 BOM; without strip_xml_bom quick-xml emits a stray Text
        // event before the prolog and downstream metadata extraction
        // mis-attributes elements. Smoke test: parse must succeed and
        // recover dc:title.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(
            br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>BOM Book</dc:title>
  </metadata>
  <manifest/>
</package>"#,
        );
        let opf = parse_opf(&bytes).expect("opf parses through BOM");
        assert_eq!(opf.metadata.title.as_deref(), Some("BOM Book"));
    }

    #[test]
    fn read_zip_entry_falls_back_to_percent_decoded_name() {
        use std::io::Write;
        // Build an in-memory zip whose entry name is the *decoded* form
        // ("a b.txt"), then ask read_zip_entry for the *encoded* form
        // ("a%20b.txt"). The fallback path must locate the entry.
        let mut buf = Vec::<u8>::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            w.start_file("a b.txt", opts).unwrap();
            w.write_all(b"hello").unwrap();
            w.finish().unwrap();
        }
        let mut zip = ZipArchive::new(Cursor::new(buf)).unwrap();
        let bytes = read_zip_entry(&mut zip, "a%20b.txt").expect("falls back to decoded");
        assert_eq!(bytes, b"hello");
    }

    #[test]
    fn read_zip_entry_returns_error_when_not_found_either_way() {
        use std::io::Write;
        let mut buf = Vec::<u8>::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            w.start_file("real.txt", opts).unwrap();
            w.write_all(b"hi").unwrap();
            w.finish().unwrap();
        }
        let mut zip = ZipArchive::new(Cursor::new(buf)).unwrap();
        assert!(read_zip_entry(&mut zip, "missing.txt").is_err());
    }

    #[test]
    fn partial_md5_medium_file_uses_step_windows() {
        // For a >2 KiB file the i = 0 iteration reads bytes [1024..2048],
        // and (assuming the file is shorter than 16 KiB) i = 2 sees
        // start=16384 >= file.size and breaks. Verify Rust matches that.
        let dir = std::env::temp_dir();
        let path = dir.join("readest-epub-parser-test-medium.bin");
        let mut data = Vec::with_capacity(2048);
        for i in 0..2048u32 {
            data.push((i & 0xff) as u8);
        }
        std::fs::write(&path, &data).unwrap();
        let hash = compute_partial_md5(&path).unwrap();
        // i=-1 -> shift=30, 1024 << 30 (i32 overflow -> negative) -> we treat
        //          as 0; start=0, read [0..1024).
        // i=0 -> shift=0, start=1024, read [1024..2048).
        // i=1 -> shift=2, start=4096 >= 2048, break.
        let mut expected = Md5::new();
        expected.update(&data[0..1024]);
        expected.update(&data[1024..2048]);
        let expected_hash = format!("{:x}", expected.finalize());
        assert_eq!(hash, expected_hash);
        // Cross-validated against `node` running the JS reference algorithm
        // on the identical buffer: ranges = [[0,1024],[1024,2048]],
        // md5 = 1576a94d6cb334dd126cb1c27f19e0f2.
        assert_eq!(hash, "1576a94d6cb334dd126cb1c27f19e0f2");
        let _ = std::fs::remove_file(path);
    }
}
