/// Cover image extraction for various eBook formats
///
/// Supports: EPUB, MOBI/AZW3/KF8, FB2, CBZ/CBR, TXT
use anyhow::{anyhow, Result};
use base64::engine::general_purpose;
use base64::Engine as _;
use directories_next::ProjectDirs;
use image::{imageops, DynamicImage, Rgba};
use md5::Context;
use once_cell::sync::Lazy;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;
use zip::ZipArchive;

/// Thumbnail cache directory (per-user)
static CACHE_DIR: Lazy<Option<std::path::PathBuf>> = Lazy::new(|| {
    ProjectDirs::from("app", "Readest", "").map(|pd| {
        let dir = pd.cache_dir().join("thumbnails");
        let _ = std::fs::create_dir_all(&dir);
        dir
    })
});

// ─────────────────────────────────────────────────────────────────────────────
// EPUB extraction
// ─────────────────────────────────────────────────────────────────────────────

/// Extract cover image bytes from an EPUB file.
pub fn extract_epub_cover_bytes<R: Read + Seek>(reader: R) -> Result<Vec<u8>> {
    let mut archive = ZipArchive::new(reader)?;

    // Pass 1: Look for files with "cover" in the name
    let mut candidates: Vec<(usize, String, u64)> = Vec::new();
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_lowercase();
        let size = file.size();
        drop(file);

        if is_image_extension(&name) && (name.contains("cover") || name.contains("front")) {
            candidates.push((i, name, size));
        }
    }

    // Sort by priority: exact "cover" match first, then by size
    if !candidates.is_empty() {
        candidates.sort_by(|a, b| {
            let a_exact = a.1.contains("cover.") || a.1.ends_with("cover");
            let b_exact = b.1.contains("cover.") || b.1.ends_with("cover");
            match (a_exact, b_exact) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => b.2.cmp(&a.2),
            }
        });

        let idx = candidates[0].0;
        let mut file = archive.by_index(idx)?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        return Ok(buf);
    }

    // Pass 2: Parse container.xml to find OPF, then parse OPF for cover
    let container_xml = read_zip_file_to_string(&mut archive, "META-INF/container.xml");
    if let Ok(xml) = container_xml {
        if let Some(rootfile) = extract_attribute(&xml, "rootfile", "full-path") {
            let opf_content = read_zip_file_to_string(&mut archive, &rootfile);
            if let Ok(opf) = opf_content {
                if let Some(cover_id) = find_cover_id_in_opf(&opf) {
                    if let Some(href) = find_href_by_id_in_opf(&opf, &cover_id) {
                        let base = Path::new(&rootfile).parent().unwrap_or(Path::new(""));
                        let cover_path = base.join(&href).to_string_lossy().replace('\\', "/");
                        if let Ok(bytes) = read_zip_file_to_bytes(&mut archive, &cover_path) {
                            return Ok(bytes);
                        }
                    }
                }
                if let Some(href) = find_first_image_in_manifest(&opf) {
                    let base = Path::new(&rootfile).parent().unwrap_or(Path::new(""));
                    let cover_path = base.join(&href).to_string_lossy().replace('\\', "/");
                    if let Ok(bytes) = read_zip_file_to_bytes(&mut archive, &cover_path) {
                        return Ok(bytes);
                    }
                }
            }
        }
    }

    // Pass 3: Just grab the largest image file
    let mut largest: Option<(usize, u64)> = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_lowercase();
        let size = file.size();
        drop(file);

        if is_image_extension(&name) && (largest.is_none() || size > largest.unwrap().1) {
            largest = Some((i, size));
        }
    }

    if let Some((idx, _)) = largest {
        let mut file = archive.by_index(idx)?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        return Ok(buf);
    }

    Err(anyhow!("No cover image found in EPUB"))
}

// ─────────────────────────────────────────────────────────────────────────────
// MOBI/AZW3/KF8 extraction
// ─────────────────────────────────────────────────────────────────────────────

/// Extract cover image from MOBI/AZW3/KF8 files.
pub fn extract_mobi_cover_bytes<R: Read + Seek>(mut reader: R) -> Result<Vec<u8>> {
    let mut header = [0u8; 78];
    reader.read_exact(&mut header)?;

    if &header[60..68] != b"BOOKMOBI" {
        return Err(anyhow!("Not a valid MOBI file"));
    }

    let num_records = u16::from_be_bytes([header[76], header[77]]) as usize;

    let mut record_offsets: Vec<u32> = Vec::with_capacity(num_records);
    for _ in 0..num_records {
        let mut rec = [0u8; 8];
        reader.read_exact(&mut rec)?;
        record_offsets.push(u32::from_be_bytes([rec[0], rec[1], rec[2], rec[3]]));
    }

    if record_offsets.is_empty() {
        return Err(anyhow!("No records in MOBI file"));
    }

    reader.seek(SeekFrom::Start(record_offsets[0] as u64))?;
    let mut mobi_header = [0u8; 256];
    reader.read_exact(&mut mobi_header)?;

    if &mobi_header[16..20] != b"MOBI" {
        return Err(anyhow!("Invalid MOBI header"));
    }

    let header_length = u32::from_be_bytes([
        mobi_header[20],
        mobi_header[21],
        mobi_header[22],
        mobi_header[23],
    ]) as usize;

    let exth_flags = u32::from_be_bytes([
        mobi_header[128],
        mobi_header[129],
        mobi_header[130],
        mobi_header[131],
    ]);
    if exth_flags & 0x40 == 0 {
        return Err(anyhow!("No EXTH header in MOBI file"));
    }

    let exth_offset = record_offsets[0] as u64 + 16 + header_length as u64;
    reader.seek(SeekFrom::Start(exth_offset))?;

    let mut exth_magic = [0u8; 4];
    reader.read_exact(&mut exth_magic)?;
    if &exth_magic != b"EXTH" {
        return Err(anyhow!("EXTH header not found"));
    }

    let mut exth_len_bytes = [0u8; 4];
    reader.read_exact(&mut exth_len_bytes)?;

    let mut exth_count_bytes = [0u8; 4];
    reader.read_exact(&mut exth_count_bytes)?;
    let exth_count = u32::from_be_bytes(exth_count_bytes) as usize;

    let mut cover_offset: Option<u32> = None;
    let first_img_idx = u32::from_be_bytes([
        mobi_header[108],
        mobi_header[109],
        mobi_header[110],
        mobi_header[111],
    ]);

    for _ in 0..exth_count {
        let mut rec_header = [0u8; 8];
        if reader.read_exact(&mut rec_header).is_err() {
            break;
        }
        let rec_type =
            u32::from_be_bytes([rec_header[0], rec_header[1], rec_header[2], rec_header[3]]);
        let rec_len =
            u32::from_be_bytes([rec_header[4], rec_header[5], rec_header[6], rec_header[7]])
                as usize;

        let data_len = rec_len.saturating_sub(8);
        let mut data = vec![0u8; data_len];
        if reader.read_exact(&mut data).is_err() {
            break;
        }

        if rec_type == 201 && data_len >= 4 {
            cover_offset = Some(u32::from_be_bytes([data[0], data[1], data[2], data[3]]));
        }
    }

    let cover_record_idx = if let Some(offset) = cover_offset {
        first_img_idx + offset
    } else {
        first_img_idx
    };

    if cover_record_idx as usize >= record_offsets.len() {
        return Err(anyhow!("Cover record index out of bounds"));
    }

    let start = record_offsets[cover_record_idx as usize] as u64;
    let end = if (cover_record_idx as usize + 1) < record_offsets.len() {
        record_offsets[cover_record_idx as usize + 1] as u64
    } else {
        reader.seek(SeekFrom::End(0))?;
        reader.stream_position()?
    };

    let len = (end - start) as usize;
    reader.seek(SeekFrom::Start(start))?;
    let mut cover_data = vec![0u8; len];
    reader.read_exact(&mut cover_data)?;

    if cover_data.starts_with(&[0xFF, 0xD8, 0xFF])
        || cover_data.starts_with(&[0x89, 0x50, 0x4E, 0x47])
        || cover_data.starts_with(b"GIF")
    {
        return Ok(cover_data);
    }

    Err(anyhow!("No valid cover image found in MOBI"))
}

// ─────────────────────────────────────────────────────────────────────────────
// CBZ extraction
// ─────────────────────────────────────────────────────────────────────────────

/// Extract cover image from CBZ (comic book ZIP) file.
pub fn extract_cbz_cover_bytes<R: Read + Seek>(reader: R) -> Result<Vec<u8>> {
    let mut archive = ZipArchive::new(reader)?;

    let mut images: Vec<(usize, String)> = Vec::new();
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();
        drop(file);

        if is_image_extension(&name.to_lowercase()) {
            images.push((i, name));
        }
    }

    images.sort_by(|a, b| a.1.cmp(&b.1));

    if let Some((idx, _)) = images.first() {
        let mut file = archive.by_index(*idx)?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        return Ok(buf);
    }

    Err(anyhow!("No images found in CBZ"))
}

// ─────────────────────────────────────────────────────────────────────────────
// FB2 extraction
// ─────────────────────────────────────────────────────────────────────────────

/// Extract cover image from FB2 (FictionBook) file.
pub fn extract_fb2_cover_bytes<R: Read>(mut reader: R) -> Result<Vec<u8>> {
    let mut content = String::new();
    reader.read_to_string(&mut content)?;

    let cover_id = if let Some(start) = content.find("<coverpage>") {
        let end = content[start..].find("</coverpage>").unwrap_or(500);
        let coverpage = &content[start..start + end];
        if let Some(href_pos) = coverpage.find("href=\"#") {
            let id_start = href_pos + 7;
            let id_end = coverpage[id_start..].find('"').unwrap_or(50);
            Some(coverpage[id_start..id_start + id_end].to_string())
        } else if let Some(href_pos) = coverpage.find("l:href=\"#") {
            let id_start = href_pos + 9;
            let id_end = coverpage[id_start..].find('"').unwrap_or(50);
            Some(coverpage[id_start..id_start + id_end].to_string())
        } else {
            None
        }
    } else {
        None
    };

    let search_pattern = if let Some(ref id) = cover_id {
        format!("<binary id=\"{}\"", id)
    } else {
        "<binary".to_string()
    };

    if let Some(pos) = content.find(&search_pattern) {
        if let Some(tag_end) = content[pos..].find('>') {
            let data_start = pos + tag_end + 1;
            if let Some(data_end) = content[data_start..].find("</binary>") {
                let b64_data = content[data_start..data_start + data_end].trim();
                let b64_clean: String = b64_data.chars().filter(|c| !c.is_whitespace()).collect();
                let bytes = general_purpose::STANDARD.decode(&b64_clean)?;
                return Ok(bytes);
            }
        }
    }

    if cover_id.is_some() {
        if let Some(pos) = content.find("<binary") {
            if let Some(tag_end) = content[pos..].find('>') {
                let data_start = pos + tag_end + 1;
                if let Some(data_end) = content[data_start..].find("</binary>") {
                    let b64_data = content[data_start..data_start + data_end].trim();
                    let b64_clean: String =
                        b64_data.chars().filter(|c| !c.is_whitespace()).collect();
                    let bytes = general_purpose::STANDARD.decode(&b64_clean)?;
                    return Ok(bytes);
                }
            }
        }
    }

    Err(anyhow!("No cover image found in FB2"))
}

// ─────────────────────────────────────────────────────────────────────────────
// TXT "cover" (placeholder)
// ─────────────────────────────────────────────────────────────────────────────

/// Generate a placeholder thumbnail for TXT files.
pub fn extract_txt_cover_bytes<R: Read>(mut reader: R, size: u32) -> Result<Vec<u8>> {
    let mut buf = vec![0u8; 4096];
    let _n = reader.read(&mut buf)?;

    let mut img = image::RgbaImage::from_pixel(size, size, Rgba([245, 245, 245, 255]));

    for x in 0..size {
        img.put_pixel(x, 0, Rgba([200, 200, 200, 255]));
        img.put_pixel(x, size - 1, Rgba([200, 200, 200, 255]));
    }
    for y in 0..size {
        img.put_pixel(0, y, Rgba([200, 200, 200, 255]));
        img.put_pixel(size - 1, y, Rgba([200, 200, 200, 255]));
    }

    let mut out = Vec::new();
    DynamicImage::ImageRgba8(img).write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)?;
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified extraction by extension
// ─────────────────────────────────────────────────────────────────────────────

/// Extract cover image bytes based on file extension.
pub fn extract_cover_bytes_by_ext(path: &Path, ext: &str) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    match ext.to_lowercase().as_str() {
        "epub" => extract_epub_cover_bytes(file),
        "mobi" | "azw" | "azw3" | "kf8" | "prc" => extract_mobi_cover_bytes(file),
        "cbz" | "cbr" => extract_cbz_cover_bytes(file),
        "fb2" => extract_fb2_cover_bytes(file),
        "txt" => extract_txt_cover_bytes(file, 256),
        _ => Err(anyhow!("Unsupported format: {}", ext)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail creation with overlay
// ─────────────────────────────────────────────────────────────────────────────

/// Create a thumbnail from cover image bytes with Readest icon overlay.
pub fn create_thumbnail_with_overlay(cover_bytes: &[u8], requested_size: u32) -> Result<Vec<u8>> {
    let img = image::load_from_memory(cover_bytes)?;
    let thumbnail = img.thumbnail(requested_size, requested_size);

    let overlay_img = load_overlay_icon();

    let mut base = thumbnail.to_rgba8();
    let (base_w, base_h) = (base.width(), base.height());

    if let Some(ov) = overlay_img {
        let overlay_size = (requested_size / 5).clamp(24, 48);
        let ov_resized = ov.resize(overlay_size, overlay_size, imageops::FilterType::Lanczos3);
        let ovb = ov_resized.to_rgba8();
        let (ov_w, ov_h) = (ovb.width(), ovb.height());

        let x = base_w.saturating_sub(ov_w + 4);
        let y = base_h.saturating_sub(ov_h + 4);

        for oy in 0..ov_h {
            for ox in 0..ov_w {
                let dst_x = x + ox;
                let dst_y = y + oy;

                if dst_x < base_w && dst_y < base_h {
                    let src_pixel = ovb.get_pixel(ox, oy);
                    let alpha = src_pixel.0[3] as f32 / 255.0;

                    if alpha > 0.0 {
                        let dst_pixel = base.get_pixel(dst_x, dst_y);
                        let mut result = dst_pixel.0;

                        for c in 0..3 {
                            let fg = src_pixel.0[c] as f32;
                            let bg = result[c] as f32;
                            result[c] = (fg * alpha + bg * (1.0 - alpha)) as u8;
                        }
                        result[3] = 255;

                        base.put_pixel(dst_x, dst_y, Rgba(result));
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    DynamicImage::ImageRgba8(base).write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)?;
    Ok(out)
}

/// Load the Readest overlay icon.
fn load_overlay_icon() -> Option<DynamicImage> {
    // Try embedded icon
    let icon_bytes = include_bytes!("../../../public/icon.png");
    if let Ok(img) = image::load_from_memory(icon_bytes) {
        return Some(img);
    }

    // Fallback: try loading from filesystem
    if let Ok(exe) = std::env::current_exe() {
        let candidates = [
            exe.parent().map(|p| p.join("icon.png")),
            exe.parent().map(|p| p.join("resources").join("icon.png")),
            exe.parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("resources").join("icon.png")),
        ];

        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() {
                if let Ok(bytes) = std::fs::read(&candidate) {
                    if let Ok(img) = image::load_from_memory(&bytes) {
                        return Some(img);
                    }
                }
            }
        }
    }

    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Caching
// ─────────────────────────────────────────────────────────────────────────────

/// Generate a thumbnail with disk caching.
pub fn cached_thumbnail_for_path(path: &Path, ext: &str, size: u32) -> Result<Vec<u8>> {
    // Compute cache key by hashing file parts for stability without loading entire file
    let mut hasher = Context::new();
    hasher.consume(ext.as_bytes());
    hasher.consume(&size.to_le_bytes());

    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    let file_len = metadata.len();

    // Read partial chunks like the TypeScript partialMD5 implementation
    const STEP: u64 = 1024;
    const SIZE: u64 = 1024;
    let mut file = file;

    for i in -1i32..=10 {
        let pos = if i == -1 {
            256u64
        } else {
            STEP << (2 * i as u32)
        };
        let start = pos.min(file_len);
        let end = (start + SIZE).min(file_len);

        if start >= file_len {
            break;
        }

        file.seek(SeekFrom::Start(start))?;
        let mut buf = vec![0u8; (end - start) as usize];
        file.read_exact(&mut buf)?;
        hasher.consume(&buf);
    }

    let digest = hasher.finalize();
    let key = format!("{:x}.png", digest);

    if let Some(ref dir) = *CACHE_DIR {
        let cache_path = dir.join(&key);
        if cache_path.exists() {
            if let Ok(cached) = std::fs::read(&cache_path) {
                return Ok(cached);
            }
        }
    }

    let cover = extract_cover_bytes_by_ext(path, ext)?;
    let thumbnail = create_thumbnail_with_overlay(&cover, size)?;

    if let Some(ref dir) = *CACHE_DIR {
        let cache_path = dir.join(&key);
        let _ = std::fs::write(&cache_path, &thumbnail);
    }

    Ok(thumbnail)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

fn is_image_extension(name: &str) -> bool {
    name.ends_with(".jpg")
        || name.ends_with(".jpeg")
        || name.ends_with(".png")
        || name.ends_with(".gif")
        || name.ends_with(".webp")
        || name.ends_with(".bmp")
}

fn read_zip_file_to_string<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<String> {
    let mut file = archive.by_name(name)?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    Ok(content)
}

fn read_zip_file_to_bytes<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>> {
    let mut file = archive.by_name(name)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

fn extract_attribute(xml: &str, tag: &str, attr: &str) -> Option<String> {
    let pattern = format!("<{}", tag);
    if let Some(tag_pos) = xml.find(&pattern) {
        let tag_end = xml[tag_pos..].find('>').unwrap_or(500) + tag_pos;
        let tag_content = &xml[tag_pos..tag_end];

        let attr_pattern = format!("{}=\"", attr);
        if let Some(attr_pos) = tag_content.find(&attr_pattern) {
            let value_start = attr_pos + attr_pattern.len();
            if let Some(value_end) = tag_content[value_start..].find('"') {
                return Some(tag_content[value_start..value_start + value_end].to_string());
            }
        }
    }
    None
}

fn find_cover_id_in_opf(opf: &str) -> Option<String> {
    if let Some(pos) = opf.find("name=\"cover\"") {
        let window_start = pos.saturating_sub(50);
        let window_end = (pos + 100).min(opf.len());
        let window = &opf[window_start..window_end];

        if let Some(content_pos) = window.find("content=\"") {
            let start = content_pos + 9;
            if let Some(end) = window[start..].find('"') {
                return Some(window[start..start + end].to_string());
            }
        }
    }

    if let Some(pos) = opf.find("properties=\"cover-image\"") {
        let window_start = pos.saturating_sub(200);
        let window_end = pos;
        let window = &opf[window_start..window_end];

        if let Some(id_pos) = window.rfind("id=\"") {
            let start = id_pos + 4;
            if let Some(end) = window[start..].find('"') {
                return Some(window[start..start + end].to_string());
            }
        }
    }

    None
}

fn find_href_by_id_in_opf(opf: &str, id: &str) -> Option<String> {
    let pattern = format!("id=\"{}\"", id);
    if let Some(pos) = opf.find(&pattern) {
        let window_start = pos.saturating_sub(10);
        let window_end = (pos + 200).min(opf.len());
        let window = &opf[window_start..window_end];

        if let Some(href_pos) = window.find("href=\"") {
            let start = href_pos + 6;
            if let Some(end) = window[start..].find('"') {
                return Some(window[start..start + end].to_string());
            }
        }
    }
    None
}

fn find_first_image_in_manifest(opf: &str) -> Option<String> {
    let manifest_start = opf.find("<manifest")?;
    let manifest_end = opf[manifest_start..]
        .find("</manifest>")
        .map(|e| manifest_start + e)?;
    let manifest = &opf[manifest_start..manifest_end];

    for media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] {
        let pattern = format!("media-type=\"{}\"", media_type);
        if let Some(pos) = manifest.find(&pattern) {
            let window_start = pos.saturating_sub(200);
            let window = &manifest[window_start..pos];

            if let Some(href_pos) = window.rfind("href=\"") {
                let start = href_pos + 6;
                if let Some(end) = window[start..].find('"') {
                    return Some(window[start..start + end].to_string());
                }
            }
        }
    }

    None
}
