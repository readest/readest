/// Explorer preview pane window for Readest
///
/// PDFs show one page at a time, fitted to the pane; the mouse wheel, the
/// scrollbar and the arrow / Page Up / Page Down / Home / End keys turn pages.
/// Other formats show their cover.
use std::path::Path;

use anyhow::Result;
use image::{imageops::FilterType, DynamicImage, RgbaImage};
use windows::core::{w, PCWSTR};
use windows::Data::Pdf::PdfDocument;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, ExcludeClipRect, FillRect,
    InvalidateRect, SetDIBitsToDevice, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    PAINTSTRUCT,
};
use windows::Win32::UI::Controls::SetScrollInfo;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SetFocus, VIRTUAL_KEY, VK_DOWN, VK_END, VK_HOME, VK_LEFT, VK_NEXT, VK_PRIOR, VK_RIGHT, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, GetScrollInfo,
    GetWindowLongPtrW, RegisterClassW, SetWindowLongPtrW, UnregisterClassW, CS_HREDRAW, CS_VREDRAW,
    GWLP_USERDATA, SB_BOTTOM, SB_LINEDOWN, SB_LINEUP, SB_PAGEDOWN, SB_PAGEUP, SB_THUMBTRACK,
    SB_TOP, SB_VERT, SCROLLBAR_COMMAND, SCROLLINFO, SIF_ALL, SIF_PAGE, SIF_POS, SIF_RANGE,
    WINDOW_EX_STYLE, WM_ERASEBKGND, WM_KEYDOWN, WM_LBUTTONDOWN, WM_MOUSEWHEEL, WM_NCDESTROY,
    WM_PAINT, WM_VSCROLL, WNDCLASSW, WS_CHILD, WS_VISIBLE, WS_VSCROLL,
};

use crate::extraction::extract_cover_bytes_by_ext;
use crate::pdf::{open_pdf, render_pdf_page};

const CLASS_NAME: PCWSTR = w!("Readest_PreviewPane");
const MARGIN: i32 = 4;
const BACKGROUND: COLORREF = COLORREF(0x00999999);

/// Move `delta` pages from `page`, staying within `0..count`.
fn step_page(page: u32, count: u32, delta: i32) -> u32 {
    (page as i64 + delta as i64).clamp(0, count.saturating_sub(1) as i64) as u32
}

enum Content {
    Pdf {
        doc: PdfDocument,
        page: u32,
        count: u32,
    },
    Cover(DynamicImage),
}

struct PreviewWindow {
    content: Content,
    /// The last drawn frame as BGRA pixels, keyed by (page, max width, max height).
    frame: Option<((u32, u32, u32), RgbaImage)>,
}

impl PreviewWindow {
    fn frame(&mut self, max_w: u32, max_h: u32) -> Option<&RgbaImage> {
        let key = match self.content {
            Content::Pdf { page, .. } => (page, max_w, max_h),
            Content::Cover(_) => (0, max_w, max_h),
        };
        if self.frame.as_ref().map(|(k, _)| *k) != Some(key) {
            let mut img = match &self.content {
                Content::Pdf { doc, page, .. } => {
                    let png = render_pdf_page(doc, *page, max_w, max_h).ok()?;
                    image::load_from_memory(&png).ok()?.to_rgba8()
                }
                Content::Cover(cover) => {
                    cover.resize(max_w, max_h, FilterType::Triangle).to_rgba8()
                }
            };
            for px in img.pixels_mut() {
                px.0.swap(0, 2);
            }
            self.frame = Some((key, img));
        }
        self.frame.as_ref().map(|(_, img)| img)
    }

    unsafe fn go_to(&mut self, hwnd: HWND, target: u32) {
        if let Content::Pdf { page, .. } = &mut self.content {
            if *page != target {
                *page = target;
                let si = SCROLLINFO {
                    cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                    fMask: SIF_POS,
                    nPos: target as i32,
                    ..Default::default()
                };
                SetScrollInfo(hwnd, SB_VERT, &si, true);
                let _ = InvalidateRect(Some(hwnd), None, false);
            }
        }
    }

    unsafe fn turn(&mut self, hwnd: HWND, delta: i32) {
        if let Content::Pdf { page, count, .. } = self.content {
            self.go_to(hwnd, step_page(page, count, delta));
        }
    }
}

fn load_content(path: &Path, ext: &str) -> Result<Content> {
    if ext == "pdf" {
        let doc = open_pdf(path)?;
        let count = doc.PageCount()?;
        return Ok(Content::Pdf {
            doc,
            page: 0,
            count,
        });
    }
    let cover = extract_cover_bytes_by_ext(path, ext)?;
    Ok(Content::Cover(image::load_from_memory(&cover)?))
}

/// Create the preview window for `path` as a child of `parent`.
pub fn create_preview_window(
    parent: HWND,
    rect: &RECT,
    instance: HINSTANCE,
    path: &Path,
    ext: &str,
) -> Result<HWND> {
    let content = load_content(path, ext)?;
    let page_count = match content {
        Content::Pdf { count, .. } => count,
        Content::Cover(_) => 1,
    };
    let mut style = WS_CHILD | WS_VISIBLE;
    if page_count > 1 {
        style |= WS_VSCROLL;
    }

    unsafe {
        let class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance,
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        // Fails harmlessly when the class is still registered from a previous preview.
        RegisterClassW(&class);

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CLASS_NAME,
            None,
            style,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            Some(parent),
            None,
            Some(instance),
            None,
        )?;
        let state = Box::new(PreviewWindow {
            content,
            frame: None,
        });
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, Box::into_raw(state) as isize);

        if page_count > 1 {
            let si = SCROLLINFO {
                cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                fMask: SIF_RANGE | SIF_PAGE | SIF_POS,
                nMin: 0,
                nMax: page_count as i32 - 1,
                nPage: 1,
                nPos: 0,
                ..Default::default()
            };
            SetScrollInfo(hwnd, SB_VERT, &si, true);
        }
        Ok(hwnd)
    }
}

pub fn destroy_preview_window(hwnd: HWND, instance: HINSTANCE) {
    unsafe {
        let _ = DestroyWindow(hwnd);
        // Windows doesn't unregister a DLL's window classes when it unloads.
        let _ = UnregisterClassW(CLASS_NAME, Some(instance));
    }
}

unsafe fn paint(hwnd: HWND, state: &mut PreviewWindow) {
    let mut ps = PAINTSTRUCT::default();
    let hdc = BeginPaint(hwnd, &mut ps);
    let mut rc = RECT::default();
    let _ = GetClientRect(hwnd, &mut rc);
    let max_w = (rc.right - 2 * MARGIN).max(1) as u32;
    let max_h = (rc.bottom - 2 * MARGIN).max(1) as u32;

    if let Some(img) = state.frame(max_w, max_h) {
        let (w, h) = (img.width() as i32, img.height() as i32);
        let (x, y) = ((rc.right - w) / 2, (rc.bottom - h) / 2);
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        SetDIBitsToDevice(
            hdc,
            x,
            y,
            w as u32,
            h as u32,
            0,
            0,
            0,
            h as u32,
            img.as_raw().as_ptr() as *const _,
            &bmi,
            DIB_RGB_COLORS,
        );
        ExcludeClipRect(hdc, x, y, x + w, y + h);
    }

    let brush = CreateSolidBrush(BACKGROUND);
    FillRect(hdc, &rc, brush);
    let _ = DeleteObject(brush.into());
    let _ = EndPaint(hwnd, &ps);
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut PreviewWindow;
    if ptr.is_null() {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }
    let state = &mut *ptr;
    match msg {
        WM_PAINT => paint(hwnd, state),
        WM_ERASEBKGND => return LRESULT(1),
        WM_LBUTTONDOWN => {
            let _ = SetFocus(Some(hwnd));
        }
        WM_MOUSEWHEEL => {
            let delta = (wparam.0 >> 16) as u16 as i16;
            state.turn(hwnd, if delta > 0 { -1 } else { 1 });
        }
        WM_KEYDOWN => {
            let delta = match VIRTUAL_KEY(wparam.0 as u16) {
                VK_UP | VK_LEFT | VK_PRIOR => -1,
                VK_DOWN | VK_RIGHT | VK_NEXT => 1,
                VK_HOME => i32::MIN,
                VK_END => i32::MAX,
                _ => return DefWindowProcW(hwnd, msg, wparam, lparam),
            };
            state.turn(hwnd, delta);
        }
        WM_VSCROLL => match SCROLLBAR_COMMAND((wparam.0 & 0xFFFF) as i32) {
            SB_LINEUP | SB_PAGEUP => state.turn(hwnd, -1),
            SB_LINEDOWN | SB_PAGEDOWN => state.turn(hwnd, 1),
            SB_TOP => state.turn(hwnd, i32::MIN),
            SB_BOTTOM => state.turn(hwnd, i32::MAX),
            SB_THUMBTRACK => {
                let mut si = SCROLLINFO {
                    cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                    fMask: SIF_ALL,
                    ..Default::default()
                };
                if GetScrollInfo(hwnd, SB_VERT, &mut si).is_ok() {
                    state.go_to(hwnd, si.nTrackPos as u32);
                }
            }
            _ => {}
        },
        WM_NCDESTROY => {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            drop(Box::from_raw(ptr));
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }
        _ => return DefWindowProcW(hwnd, msg, wparam, lparam),
    }
    LRESULT(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_page_moves_within_bounds() {
        assert_eq!(step_page(3, 10, 1), 4);
        assert_eq!(step_page(3, 10, -1), 2);
        assert_eq!(step_page(0, 10, -1), 0);
        assert_eq!(step_page(9, 10, 1), 9);
        assert_eq!(step_page(2, 10, i32::MIN), 0);
        assert_eq!(step_page(2, 10, i32::MAX), 9);
    }

    #[test]
    fn cover_frame_fits_the_pane_as_bgra() {
        let cover = RgbaImage::from_pixel(60, 90, image::Rgba([255, 0, 0, 255]));
        let mut state = PreviewWindow {
            content: Content::Cover(DynamicImage::ImageRgba8(cover)),
            frame: None,
        };
        let frame = state.frame(300, 300).unwrap();
        assert_eq!((frame.width(), frame.height()), (200, 300));
        assert_eq!(frame.get_pixel(100, 150).0, [0, 0, 255, 255]);
    }
}
