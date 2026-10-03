use crate::parser_common::compute_partial_md5_file;
use flate2::read::{DeflateDecoder, ZlibDecoder};
use memmap2::Mmap;
use pdf::{
    enc::StreamFilter,
    file::FileOptions,
    object::{ParseOptions, Resolve, Stream},
    primitive::{PdfStream, PdfString},
};
use serde::Serialize;
#[cfg(test)]
use std::path::Path;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
};
use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri_plugin_fs::{FsExt, OpenOptions};
use tauri_plugin_native_bridge::{NativeBridgeExt, RenderPdfCoverRequest, RenderPdfCoverResponse};

const MAX_TRAILER_SEARCH_BYTES: u64 = 1024 * 1024;
const MAX_INFO_STRING_BYTES: usize = 64 * 1024;
const MAX_XMP_BYTES: usize = 1024 * 1024;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub title: Option<Vec<u8>>,
    pub author: Option<Vec<u8>>,
    pub subject: Option<Vec<u8>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPdfMetadata {
    pub partial_md5: String,
    pub info: PdfInfo,
    pub xmp: Option<Vec<u8>>,
}

#[tauri::command]
pub async fn parse_pdf_metadata<R: tauri::Runtime>(
    app: AppHandle<R>,
    file_path: String,
) -> Result<ParsedPdfMetadata, String> {
    ensure_path_allowed(&app, &file_path)?;
    let source = open_pdf_source(&app, &file_path)?;
    tauri::async_runtime::spawn_blocking(move || parse_pdf_metadata_file(source))
        .await
        .map_err(|e| format!("PDF parser task failed: {e}"))?
}

#[tauri::command]
pub async fn render_pdf_cover<R: tauri::Runtime>(
    app: AppHandle<R>,
    payload: RenderPdfCoverRequest,
) -> Result<RenderPdfCoverResponse, String> {
    ensure_path_allowed(&app, &payload.file_path)?;
    app.native_bridge()
        .render_pdf_cover(payload)
        .map_err(|e| e.to_string())
}

fn ensure_path_allowed<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_path: &str,
) -> Result<(), String> {
    #[cfg(feature = "webdriver")]
    let _ = (app, file_path);

    #[cfg(not(feature = "webdriver"))]
    {
        #[cfg(target_os = "android")]
        if file_path.starts_with("content://") {
            // ContentResolver enforces the picker/shared-intent URI grant when
            // the descriptor is opened. It is not a filesystem path, so it
            // cannot pass through fs_scope's Path-based validation.
            return Ok(());
        }
        crate::transfer_file::ensure_path_allowed(app, file_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn open_pdf_source<R: tauri::Runtime>(app: &AppHandle<R>, file_path: &str) -> Result<File, String> {
    #[cfg(not(target_os = "android"))]
    let _ = app;

    #[cfg(target_os = "android")]
    if file_path.starts_with("content://") {
        let mut options = OpenOptions::new();
        options.read(true);
        let uri = tauri::Url::parse(file_path)
            .map_err(|e| format!("parse PDF content URI failed: {e}"))?;
        return app
            .fs()
            .open(uri, options)
            .map_err(|e| format!("open PDF content URI failed: {e}"));
    }

    File::open(file_path).map_err(|e| format!("open PDF failed: {e}"))
}

fn pdf_string_bytes(value: &Option<PdfString>) -> Option<Vec<u8>> {
    value
        .as_ref()
        .map(PdfString::as_bytes)
        .filter(|value| !value.is_empty() && value.len() <= MAX_INFO_STRING_BYTES)
        .map(ToOwned::to_owned)
}

fn read_bounded(reader: impl Read) -> Option<Vec<u8>> {
    let mut output = Vec::new();
    reader
        .take((MAX_XMP_BYTES + 1) as u64)
        .read_to_end(&mut output)
        .ok()?;
    (output.len() <= MAX_XMP_BYTES).then_some(output)
}

fn decode_xmp(raw: &[u8], filters: &[StreamFilter]) -> Option<Vec<u8>> {
    if raw.len() > MAX_XMP_BYTES {
        return None;
    }
    match filters {
        [] => Some(raw.to_vec()),
        [StreamFilter::FlateDecode(params)] if params.predictor == 1 => {
            read_bounded(ZlibDecoder::new(raw)).or_else(|| read_bounded(DeflateDecoder::new(raw)))
        }
        _ => None,
    }
}

fn decode_xmp_stream(raw_stream: PdfStream, resolver: &impl Resolve) -> Option<Vec<u8>> {
    let stream = Stream::<()>::from_stream(raw_stream.clone(), resolver).ok()?;
    if stream.len() > MAX_XMP_BYTES {
        return None;
    }
    let raw = raw_stream.raw_data(resolver).ok()?;
    decode_xmp(&raw, stream.get_filters())
}

fn validate_trailer(source: &mut File) -> Result<(), String> {
    let file_len = source
        .metadata()
        .map_err(|e| format!("read PDF metadata failed: {e}"))?
        .len();
    let start = file_len.saturating_sub(MAX_TRAILER_SEARCH_BYTES);
    source
        .seek(SeekFrom::Start(start))
        .map_err(|e| format!("seek PDF trailer failed: {e}"))?;
    let mut trailer = Vec::with_capacity((file_len - start) as usize);
    source
        .read_to_end(&mut trailer)
        .map_err(|e| format!("read PDF trailer failed: {e}"))?;
    if !trailer
        .windows(b"startxref".len())
        .any(|window| window == b"startxref")
    {
        return Err(
            "parse PDF metadata failed: startxref is missing from the bounded trailer".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
fn parse_pdf_metadata_sync(file_path: &str) -> Result<ParsedPdfMetadata, String> {
    let source = File::open(Path::new(file_path)).map_err(|e| format!("open PDF failed: {e}"))?;
    parse_pdf_metadata_file(source)
}

fn parse_pdf_metadata_file(mut source: File) -> Result<ParsedPdfMetadata, String> {
    validate_trailer(&mut source)?;

    // Mapping exposes random-access slices to the parser without copying the
    // complete file into a Vec. The OS pages in only the regions the trailer,
    // catalog, Info dictionary, and XMP stream actually touch.
    let mmap = unsafe { Mmap::map(&source) }.map_err(|e| format!("map PDF failed: {e}"))?;
    let document = FileOptions::uncached()
        .parse_options(ParseOptions::tolerant())
        .load(mmap)
        .map_err(|e| format!("parse PDF metadata failed: {e}"))?;

    let info = document
        .trailer
        .info_dict
        .as_ref()
        .map(|info| PdfInfo {
            title: pdf_string_bytes(&info.title),
            author: pdf_string_bytes(&info.author),
            subject: pdf_string_bytes(&info.subject),
        })
        .unwrap_or_default();

    let xmp = document.get_root().metadata.and_then(|metadata_ref| {
        let resolver = document.resolver();
        let raw_stream = resolver
            .resolve(metadata_ref.get_inner())
            .ok()?
            .into_stream(&resolver)
            .ok()?;
        decode_xmp_stream(raw_stream, &resolver)
    });
    let partial_md5 =
        compute_partial_md5_file(&mut source).map_err(|e| format!("partial_md5 failed: {e}"))?;

    Ok(ParsedPdfMetadata {
        partial_md5,
        info,
        xmp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::ZlibEncoder, Compression};
    use std::{
        fs::{remove_file, OpenOptions},
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn extracts_info_and_xmp_without_loading_pdf_into_a_vec() {
        let fixture = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/__tests__/fixtures/data/sample-metadata.pdf"
        );
        let parsed = parse_pdf_metadata_sync(fixture).unwrap();

        assert_eq!(
            parsed.info.title.as_deref(),
            Some(b"PDF Metadata".as_slice())
        );
        assert_eq!(parsed.info.author.as_deref(), Some(b"Readest".as_slice()));
        assert!(parsed.xmp.as_deref().is_some_and(|xmp| xmp
            .windows(b"Metadata Series".len())
            .any(|w| w == b"Metadata Series")));
        assert!(!parsed.partial_md5.is_empty());
    }

    #[test]
    fn bounds_decompressed_xmp() {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(b"small XMP").unwrap();
        let compressed = encoder.finish().unwrap();
        assert_eq!(
            decode_xmp(
                &compressed,
                &[StreamFilter::FlateDecode(Default::default())]
            )
            .as_deref(),
            Some(b"small XMP".as_slice())
        );

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(&vec![b'x'; MAX_XMP_BYTES + 1]).unwrap();
        let compressed = encoder.finish().unwrap();
        assert!(decode_xmp(
            &compressed,
            &[StreamFilter::FlateDecode(Default::default())]
        )
        .is_none());
    }

    #[test]
    fn rejects_oversized_raw_xmp_stream_before_decoding() {
        let stream = Stream::from_compressed((), vec![b'x'; MAX_XMP_BYTES + 1], Vec::new());
        let raw_stream = stream.to_pdf_stream(&mut pdf::object::NoUpdate).unwrap();
        assert!(decode_xmp_stream(raw_stream, &pdf::object::NoResolve).is_none());
    }

    #[test]
    fn rejects_missing_startxref_after_bounded_tail_read() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "readest-pdf-missing-startxref-{}-{unique}.pdf",
            std::process::id()
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .read(true)
            .open(&path)
            .unwrap();
        file.write_all(b"%PDF-1.7\ninvalid trailer\n%%EOF").unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();

        let error = validate_trailer(&mut file).unwrap_err();
        remove_file(path).unwrap();

        assert!(error.contains("startxref is missing"));
    }
}
