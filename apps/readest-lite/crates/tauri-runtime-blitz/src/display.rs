//! `BLITZ_TAURI_WINDOW=1|gray` (cargo feature `window`): shows each painted frame in an X11 window
//! (XWayland works) so a person can use the page. Mouse clicks become pointer events at the same
//! device pixels; the wheel, arrow keys, Space and Page Up/Down click the right or left third (the
//! reader's page-turn zones). `gray` shows frames as an e-ink screen would; an 8-bit gray screen
//! (Kindle's X server) always gets gray. The window keeps the last frame for exposes and never
//! paints on its own: what you see is what the runtime painted.
use std::sync::{Arc, Mutex};

use x11rb::connection::{Connection, RequestConnection as _};
use x11rb::properties::WmSizeHints;
use x11rb::protocol::Event;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConnectionExt as _, CreateGCAux, CreateWindowAux, EventMask,
    Gcontext, ImageFormat, PropMode, Window, WindowClass,
};
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

/// Input for the page, in device pixels.
pub(crate) enum Input {
    Pointer { x: f32, y: f32, down: bool },
    Close,
}

pub(crate) struct Display {
    conn: Arc<RustConnection>,
    target: Target,
    h: u16,
    /// The last frame as sent (rows of the window's pixels), redrawn on Expose.
    last: Arc<Mutex<Vec<u8>>>,
}

impl Display {
    /// `None` when the variable is unset or no X server answers. `BLITZ_TAURI_WM_NAME` replaces
    /// the window title: Kindle's window manager places a window by its title
    /// (`L:A_N:application_ID:<id>_PC:N_O:U` is a full-screen application with no Kindle bars).
    pub fn from_env(
        w: u32,
        h: u32,
        title: &str,
        on_input: impl Fn(Input) + Send + 'static,
    ) -> Option<Self> {
        let mode = std::env::var("BLITZ_TAURI_WINDOW")
            .ok()
            .filter(|v| !v.is_empty() && v != "0")?;
        let title = std::env::var("BLITZ_TAURI_WM_NAME").unwrap_or_else(|_| title.into());
        match Self::open(w as u16, h as u16, &title, mode == "gray", on_input) {
            Ok(d) => Some(d),
            Err(e) => {
                log::error!("BLITZ_TAURI_WINDOW: no X11 window: {e}");
                None
            }
        }
    }

    fn open(
        w: u16,
        h: u16,
        title: &str,
        gray: bool,
        on_input: impl Fn(Input) + Send + 'static,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let (conn, screen_num) = RustConnection::connect(None)?;
        let conn = Arc::new(conn);
        let screen = &conn.setup().roots[screen_num];
        let (root, visual, depth, white) = (
            screen.root,
            screen.root_visual,
            screen.root_depth,
            screen.white_pixel,
        );
        let format = if depth == 8 {
            PixelFormat::Gray8 {
                invert: white < screen.black_pixel,
            }
        } else {
            PixelFormat::Bgrx { gray }
        };
        let win = conn.generate_id()?;
        let events = EventMask::EXPOSURE
            | EventMask::BUTTON_PRESS
            | EventMask::BUTTON_RELEASE
            | EventMask::KEY_PRESS;
        conn.create_window(
            depth,
            win,
            root,
            0,
            0,
            w,
            h,
            0,
            WindowClass::INPUT_OUTPUT,
            visual,
            &CreateWindowAux::new()
                .background_pixel(white)
                .event_mask(events),
        )?;
        conn.change_property8(
            PropMode::REPLACE,
            win,
            AtomEnum::WM_NAME,
            AtomEnum::STRING,
            title.as_bytes(),
        )?;
        let size = Some((i32::from(w), i32::from(h)));
        WmSizeHints {
            min_size: size,
            max_size: size,
            ..WmSizeHints::default()
        }
        .set_normal_hints(&*conn, win)?;
        let protocols = conn.intern_atom(false, b"WM_PROTOCOLS")?.reply()?.atom;
        let delete = conn.intern_atom(false, b"WM_DELETE_WINDOW")?.reply()?.atom;
        conn.change_property32(PropMode::REPLACE, win, protocols, AtomEnum::ATOM, &[delete])?;
        let gc = conn.generate_id()?;
        conn.create_gc(gc, win, &CreateGCAux::new())?;
        conn.map_window(win)?;
        conn.flush()?;
        let target = Target {
            win,
            gc,
            depth,
            w,
            format,
        };
        let d = Self {
            conn: conn.clone(),
            target,
            h,
            last: Arc::default(),
        };
        let (last, (cw, ch)) = (d.last.clone(), (f32::from(w), f32::from(h)));
        std::thread::spawn(move || {
            let click = |x: f32| {
                on_input(Input::Pointer {
                    x,
                    y: ch / 2.0,
                    down: true,
                });
                on_input(Input::Pointer {
                    x,
                    y: ch / 2.0,
                    down: false,
                });
            };
            while let Ok(ev) = conn.wait_for_event() {
                match ev {
                    Event::Expose(e) if e.count == 0 => {
                        let rows = last.lock().unwrap();
                        if let Some(all) = damage(&[], &rows, usize::from(w), format.bytes())
                            .filter(|_| !rows.is_empty())
                        {
                            let _ = put(&conn, target, &rows, all);
                        }
                    }
                    Event::ButtonPress(e) | Event::ButtonRelease(e) if e.detail == 1 => {
                        let down =
                            e.response_type & 0x7f == x11rb::protocol::xproto::BUTTON_PRESS_EVENT;
                        on_input(Input::Pointer {
                            x: f32::from(e.event_x),
                            y: f32::from(e.event_y),
                            down,
                        });
                    }
                    // wheel: 4 up = back, 5 down = forward (press only)
                    Event::ButtonPress(e) if e.detail == 4 => click(cw / 6.0),
                    Event::ButtonPress(e) if e.detail == 5 => click(cw * 5.0 / 6.0),
                    // evdev keycodes: Left 113, Up 111, Page Up 112 back; Right 114, Down 116, Page Down 117, Space 65 forward
                    Event::KeyPress(e) => match e.detail {
                        111..=113 => click(cw / 6.0),
                        114 | 116 | 117 | 65 => click(cw * 5.0 / 6.0),
                        _ => {}
                    },
                    Event::ClientMessage(ClientMessageEvent { data, .. })
                        if data.as_data32()[0] == delete =>
                    {
                        on_input(Input::Close);
                        break;
                    }
                    _ => {}
                }
            }
        });
        Ok(d)
    }

    /// Shows a cairo RGB24 frame (`stride` bytes per row; BGRX on little-endian), sending only
    /// the box that changed since the last frame (each update is a refresh on e-ink). Returns
    /// that box, `None` when nothing changed.
    pub fn present(&self, data: &[u8], stride: usize) -> Option<Rect> {
        let Target { w, format, .. } = self.target;
        let (w, h) = (usize::from(w), usize::from(self.h));
        let rows = frame_rows(data, stride, w, h, format);
        let mut last = self.last.lock().unwrap();
        let rect = damage(&last, &rows, w, format.bytes());
        if let Some(rect) = rect
            && let Err(e) = put(&self.conn, self.target, &rows, rect)
        {
            log::error!("BLITZ_TAURI_WINDOW: {e}");
        }
        *last = rows;
        rect
    }
}

/// The window frames go to.
#[derive(Clone, Copy)]
struct Target {
    win: Window,
    gc: Gcontext,
    depth: u8,
    w: u16,
    format: PixelFormat,
}

/// How the window's pixels are laid out.
#[derive(Clone, Copy)]
enum PixelFormat {
    /// 32 bits per pixel, BGRX; `gray` shows the frame as an e-ink screen would.
    Bgrx { gray: bool },
    /// 8 bits per pixel on a StaticGray visual (Kindle's X server); `invert` when white is 0.
    Gray8 { invert: bool },
}

impl PixelFormat {
    fn bytes(self) -> usize {
        match self {
            PixelFormat::Gray8 { .. } => 1,
            PixelFormat::Bgrx { .. } => 4,
        }
    }
}

/// A cairo RGB24 frame as rows of the window's pixels.
fn frame_rows(data: &[u8], stride: usize, w: usize, h: usize, format: PixelFormat) -> Vec<u8> {
    let luma = |p: &[u8; 4]| {
        ((u32::from(p[2]) * 77 + u32::from(p[1]) * 150 + u32::from(p[0]) * 29) >> 8) as u8
    };
    let mut rows = Vec::with_capacity(w * 4 * h);
    for y in 0..h {
        let src = &data[y * stride..y * stride + w * 4];
        match format {
            PixelFormat::Bgrx { gray: true } => {
                for p in src.as_chunks::<4>().0 {
                    let g = luma(p);
                    rows.extend_from_slice(&[g, g, g, 0]);
                }
            }
            PixelFormat::Gray8 { invert } => rows.extend(
                src.as_chunks::<4>()
                    .0
                    .iter()
                    .map(|p| if invert { !luma(p) } else { luma(p) }),
            ),
            PixelFormat::Bgrx { gray: false } => rows.extend_from_slice(src),
        }
    }
    rows
}

/// A box of pixels: left, top, right, bottom (right and bottom exclusive).
pub(crate) type Rect = (usize, usize, usize, usize);

/// Where `new` differs from `old`, two frames of `w`-pixel rows with `bytes` bytes a pixel:
/// `None` when they are equal. Its left and right edges sit on 4-byte boundaries, so its rows
/// need no padding in a PutImage.
fn damage(old: &[u8], new: &[u8], w: usize, bytes: usize) -> Option<Rect> {
    let row = w * bytes;
    if old.len() != new.len() {
        return Some((0, 0, w, new.len() / row));
    }
    let (mut x0, mut y0, mut x1, mut y1) = (row, None, 0, 0);
    for (y, (a, b)) in old.chunks(row).zip(new.chunks(row)).enumerate() {
        let Some(first) = a.iter().zip(b).position(|(p, q)| p != q) else {
            continue;
        };
        let last = a.iter().zip(b).rposition(|(p, q)| p != q).unwrap();
        y0.get_or_insert(y);
        y1 = y + 1;
        x0 = x0.min(first);
        x1 = x1.max(last + 1);
    }
    let align = |b: usize| b / bytes;
    y0.map(|y0| {
        let (x0, x1) = (x0 / 4 * 4, (x1.div_ceil(4) * 4).min(row));
        (align(x0), y0, align(x1).max(align(x0) + 1), y1)
    })
}

/// PutImage in row bands that fit the server's request size.
fn put(
    conn: &RustConnection,
    Target {
        win,
        gc,
        depth,
        w,
        format,
    }: Target,
    rows: &[u8],
    (x0, y0, x1, y1): Rect,
) -> Result<(), Box<dyn std::error::Error>> {
    let bytes = format.bytes();
    let row = usize::from(w) * bytes;
    let part = (x1 - x0) * bytes;
    let band = ((conn.maximum_request_bytes() - 64) / part).max(1);
    for top in (y0..y1).step_by(band) {
        let bottom = (top + band).min(y1);
        let data: Vec<u8> = (top..bottom)
            .flat_map(|y| &rows[y * row + x0 * bytes..y * row + x1 * bytes])
            .copied()
            .collect();
        conn.put_image(
            ImageFormat::Z_PIXMAP,
            win,
            gc,
            (x1 - x0) as u16,
            (bottom - top) as u16,
            x0 as i16,
            top as i16,
            0,
            depth,
            &data,
        )?;
    }
    conn.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{PixelFormat, damage, frame_rows};

    // Each frame sent to the window is an update on e-ink; a page turn paints several frames
    // that change nothing or only the page number, and each went out whole.
    #[test]
    fn a_frame_sends_only_what_changed() {
        let (w, h) = (16, 8);
        let old = vec![255u8; w * h];
        assert_eq!(damage(&old, &old, w, 1), None);
        let mut new = old.clone();
        new[3 * w + 5] = 0; // (5, 3)
        new[5 * w + 9] = 0; // (9, 5)
        assert_eq!(damage(&old, &new, w, 1), Some((4, 3, 12, 6)));
        // 4 bytes a pixel: any column is on a 4-byte boundary
        let old4 = vec![255u8; w * 4 * h];
        let mut new4 = old4.clone();
        new4[(3 * w + 5) * 4] = 0;
        assert_eq!(damage(&old4, &new4, w, 4), Some((5, 3, 6, 4)));
        // the first frame, with nothing before it, goes out whole
        assert_eq!(damage(&[], &new, w, 1), Some((0, 0, w, h)));
    }

    // Kindle's X server has one 8-bit StaticGray visual: a pixel is one byte of gray. Rows of
    // 4-byte pixels were refused (BadLength), so the window stayed blank.
    #[test]
    fn an_8_bit_gray_window_gets_one_byte_per_pixel() {
        // one row: white, red (BGRX), then 4 bytes of stride padding
        let frame = [255, 255, 255, 0, 0, 0, 255, 0, 9, 9, 9, 9];
        let rows = |invert| frame_rows(&frame, 12, 2, 1, PixelFormat::Gray8 { invert });
        assert_eq!(rows(false), [255, 76]);
        assert_eq!(rows(true), [0, 179]);
    }
}
