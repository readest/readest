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
    win: Window,
    gc: Gcontext,
    depth: u8,
    w: u16,
    h: u16,
    format: PixelFormat,
    /// The last frame as sent (rows of the window's pixels), redrawn on Expose.
    last: Arc<Mutex<Vec<u8>>>,
}

impl Display {
    /// `None` when the variable is unset or no X server answers.
    pub fn from_env(
        w: u32,
        h: u32,
        title: &str,
        on_input: impl Fn(Input) + Send + 'static,
    ) -> Option<Self> {
        let mode = std::env::var("BLITZ_TAURI_WINDOW")
            .ok()
            .filter(|v| !v.is_empty() && v != "0")?;
        match Self::open(w as u16, h as u16, title, mode == "gray", on_input) {
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
        let d = Self {
            conn: conn.clone(),
            win,
            gc,
            depth,
            w,
            h,
            format,
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
                        if !rows.is_empty() {
                            let _ = put(&conn, win, gc, depth, w, format, &rows);
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

    /// Shows a cairo RGB24 frame (`stride` bytes per row; BGRX on little-endian).
    pub fn present(&self, data: &[u8], stride: usize) {
        let (w, h) = (usize::from(self.w), usize::from(self.h));
        let rows = frame_rows(data, stride, w, h, self.format);
        if let Err(e) = put(
            &self.conn,
            self.win,
            self.gc,
            self.depth,
            self.w,
            self.format,
            &rows,
        ) {
            log::error!("BLITZ_TAURI_WINDOW: {e}");
        }
        *self.last.lock().unwrap() = rows;
    }
}

/// How the window's pixels are laid out.
#[derive(Clone, Copy)]
enum PixelFormat {
    /// 32 bits per pixel, BGRX; `gray` shows the frame as an e-ink screen would.
    Bgrx { gray: bool },
    /// 8 bits per pixel on a StaticGray visual (Kindle's X server); `invert` when white is 0.
    Gray8 { invert: bool },
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

/// PutImage in row bands that fit the server's request size.
fn put(
    conn: &RustConnection,
    win: Window,
    gc: Gcontext,
    depth: u8,
    w: u16,
    format: PixelFormat,
    rows: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let bytes = if matches!(format, PixelFormat::Gray8 { .. }) {
        1
    } else {
        4
    };
    let row = usize::from(w) * bytes;
    let band = ((conn.maximum_request_bytes() - 64) / row).max(1);
    for (i, chunk) in rows.chunks(band * row).enumerate() {
        let y = (i * band) as i16;
        conn.put_image(
            ImageFormat::Z_PIXMAP,
            win,
            gc,
            w,
            (chunk.len() / row) as u16,
            0,
            y,
            0,
            depth,
            chunk,
        )?;
    }
    conn.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{PixelFormat, frame_rows};

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
