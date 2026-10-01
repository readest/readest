//! PDF page rendering through `Windows.Data.Pdf`, the PDF engine built into
//! Windows 10+, so the DLL doesn't have to bundle one.
use anyhow::Result;
use std::path::Path;
use windows::core::HSTRING;
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Storage::Streams::{DataReader, IRandomAccessStream, InMemoryRandomAccessStream};
use windows::Win32::System::WinRT::CreateRandomAccessStreamOnFile;

/// Scale a `page_w` x `page_h` page to the largest size that fits `max_w` x `max_h`.
pub fn fit_within(page_w: f32, page_h: f32, max_w: u32, max_h: u32) -> (u32, u32) {
    let scale = (max_w as f32 / page_w).min(max_h as f32 / page_h);
    let w = (page_w * scale).round().max(1.0) as u32;
    let h = (page_h * scale).round().max(1.0) as u32;
    (w, h)
}

pub fn open_pdf(path: &Path) -> Result<PdfDocument> {
    // FileAccessMode::Read
    let stream: IRandomAccessStream =
        unsafe { CreateRandomAccessStreamOnFile(&HSTRING::from(path), 0)? };
    Ok(PdfDocument::LoadFromStreamAsync(&stream)?.join()?)
}

/// Render page `index` scaled to fit `max_w` x `max_h`, as PNG bytes.
pub fn render_pdf_page(doc: &PdfDocument, index: u32, max_w: u32, max_h: u32) -> Result<Vec<u8>> {
    let page = doc.GetPage(index)?;
    let size = page.Size()?;
    let (w, h) = fit_within(size.Width, size.Height, max_w, max_h);
    let options = PdfPageRenderOptions::new()?;
    options.SetDestinationWidth(w)?;
    options.SetDestinationHeight(h)?;

    let out = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&out, &options)?
        .join()?;
    let len = out.Size()? as u32;
    let reader = DataReader::CreateDataReader(&out.GetInputStreamAt(0)?)?;
    reader.LoadAsync(len)?.join()?;
    let mut png = vec![0u8; len as usize];
    reader.ReadBytes(&mut png)?;
    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_within_keeps_aspect_ratio() {
        assert_eq!(fit_within(612.0, 792.0, 1024, 1024), (791, 1024));
        assert_eq!(fit_within(1000.0, 500.0, 300, 200), (300, 150));
    }

    #[test]
    fn fit_within_never_returns_zero() {
        assert_eq!(fit_within(10.0, 10000.0, 100, 100), (1, 100));
        assert_eq!(fit_within(612.0, 792.0, 0, 0), (1, 1));
    }

    // Windows.Data.Pdf isn't available under Wine: run with `--ignored` on Windows.
    #[test]
    #[ignore]
    fn renders_first_page_to_png() {
        let path = std::env::temp_dir().join("readest_thumbnail_test.pdf");
        std::fs::write(&path, minimal_pdf()).unwrap();
        let doc = open_pdf(&path).unwrap();
        assert_eq!(doc.PageCount().unwrap(), 1);
        let png = render_pdf_page(&doc, 0, 256, 256).unwrap();
        let img = image::load_from_memory(&png).unwrap();
        assert_eq!((img.width(), img.height()), (198, 256));
    }

    /// A one-page 612x792 PDF with a correct xref table.
    fn minimal_pdf() -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, obj) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend(format!("{} 0 obj\n{}\nendobj\n", i + 1, obj).bytes());
        }
        let xref = pdf.len();
        pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
        for offset in offsets {
            pdf.extend(format!("{:010} 00000 n \n", offset).bytes());
        }
        pdf.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
                objects.len() + 1,
                xref
            )
            .bytes(),
        );
        pdf
    }
}
