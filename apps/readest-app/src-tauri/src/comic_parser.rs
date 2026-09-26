// Native page measuring for comic archives (CBZ).
//
// A comic's double-page spread is usually stored as one wide image, and the
// reader gives each wide page a spread of its own. It has to know them all
// before laying out the book, since a spread moves every later page onto the
// other side. The webview's file layer fetches 128 KB to 1 MB for every small
// read, one call per page; here a single pass over the archive inflates only
// the header bytes of each image. The web fallback lives in utils/spread.ts.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek};

use imagesize::ImageError;
use zip::ZipArchive;

// A page is read a step at a time until its size parses: a JPEG keeps the size
// behind its metadata segments, often tens of kilobytes in.
const HEAD_STEP: u64 = 16 * 1024;
const HEAD_LIMIT: u64 = 256 * 1024;

/// `[width, height]` in pixels of each image in the archive, by entry path.
/// Entries that are not images, or not readable, are left out.
#[tauri::command]
pub async fn get_comic_page_sizes(
    file_path: String,
) -> Result<HashMap<String, [usize; 2]>, String> {
    // Off the IPC dispatch thread, like the other parsers.
    tauri::async_runtime::spawn_blocking(move || {
        let file = File::open(&file_path).map_err(|e| format!("open failed: {e}"))?;
        let mut zip = ZipArchive::new(file).map_err(|e| format!("zip open failed: {e}"))?;
        Ok(page_sizes(&mut zip))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

fn page_sizes<R: Read + Seek>(zip: &mut ZipArchive<R>) -> HashMap<String, [usize; 2]> {
    let mut sizes = HashMap::new();
    for i in 0..zip.len() {
        // Encrypted entries fail here; they stay unmeasured.
        let Ok(entry) = zip.by_index(i) else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if let Some(size) = read_image_size(entry) {
            sizes.insert(name, size);
        }
    }
    sizes
}

fn read_image_size(reader: impl Read) -> Option<[usize; 2]> {
    let mut reader = reader.take(HEAD_LIMIT);
    let mut head = Vec::new();
    loop {
        let read = reader
            .by_ref()
            .take(HEAD_STEP)
            .read_to_end(&mut head)
            .ok()?;
        match imagesize::blob_size(&head) {
            Ok(size) => return Some([size.width, size.height]),
            // The header runs past what has been read: read on, if there is more.
            Err(ImageError::IoError(_)) if read > 0 => continue,
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        data.extend(width.to_be_bytes());
        data.extend(height.to_be_bytes());
        data.extend([8, 6, 0, 0, 0]);
        data
    }

    // A JPEG whose size marker sits behind `app_len` bytes of metadata.
    fn jpeg(width: u16, height: u16, app_len: u16) -> Vec<u8> {
        let mut data = vec![0xff, 0xd8, 0xff, 0xe1];
        data.extend(app_len.to_be_bytes());
        let mut x: u32 = 1;
        data.extend((2..app_len).map(|_| {
            x = x.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (x >> 24) as u8
        }));
        data.extend([0xff, 0xc0, 0x00, 0x11, 0x08]);
        data.extend(height.to_be_bytes());
        data.extend(width.to_be_bytes());
        data
    }

    fn archive(entries: &[(&str, Vec<u8>, CompressionMethod)]) -> ZipArchive<Cursor<Vec<u8>>> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            for (name, data, method) in entries {
                w.start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(*method),
                )
                .unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        ZipArchive::new(Cursor::new(buf)).unwrap()
    }

    #[test]
    fn measures_each_image_from_its_header() {
        let mut zip = archive(&[
            ("01.png", png(1200, 1829), CompressionMethod::Stored),
            // Size marker past the first read step.
            (
                "02.jpg",
                jpeg(2200, 1673, 40_000),
                CompressionMethod::Deflated,
            ),
            (
                "ComicInfo.xml",
                b"<ComicInfo/>".to_vec(),
                CompressionMethod::Deflated,
            ),
        ]);
        let sizes = page_sizes(&mut zip);
        assert_eq!(sizes.len(), 2);
        assert_eq!(sizes["01.png"], [1200, 1829]);
        assert_eq!(sizes["02.jpg"], [2200, 1673]);
    }

    #[test]
    fn leaves_out_an_image_cut_short_before_its_size() {
        let mut data = jpeg(2200, 1673, 40_000);
        data.truncate(30_000);
        let mut zip = archive(&[("01.jpg", data, CompressionMethod::Deflated)]);
        assert!(page_sizes(&mut zip).is_empty());
    }
}
