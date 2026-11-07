//! An `anyrender::PaintScene` on cairo (pixman underneath, which has armv7 NEON paths that
//! vello_cpu's fearless_simd lacks). Glyphs go through cairo's FreeType font face, so cairo's
//! glyph cache and pixman's glyph compositing do the text. Font faces and image surfaces are
//! cached across pages by blob id, as a reader app would keep them.
//!
//! Left out (prototype): filters and backdrop filters, box-shadow blur (drawn unblurred), sweep
//! gradients (first stop), variable-font coordinates, non-sRGB gradient interpolation.

use std::{collections::HashMap, ffi::c_void, sync::Arc};

use anyrender::{Filter, Glyph, NormalizedCoord, Paint, PaintRef, PaintScene, RenderContext};
use cairo::{
    Context, Extend as CExtend, FillRule, Format, ImageSurface, LineCap, LineJoin, Matrix, Operator,
};
use peniko::{
    BlendMode, Color, Compose, Extend, Fill, FontData, GradientKind, ImageAlphaType, ImageFormat,
    ImageQuality, Mix, StyleRef,
    kurbo::{Affine, Cap, Join, PathEl, Rect, Shape, Stroke},
};

const TOLERANCE: f64 = 0.1;

#[link(name = "freetype")]
unsafe extern "C" {
    fn FT_Init_FreeType(lib: *mut *mut c_void) -> i32;
    fn FT_New_Memory_Face(
        lib: *mut c_void,
        data: *const u8,
        len: std::ffi::c_long,
        index: std::ffi::c_long,
        face: *mut *mut c_void,
    ) -> i32;
    fn cairo_ft_font_face_create_for_ft_face(
        face: *mut c_void,
        load_flags: i32,
    ) -> *mut cairo::ffi::cairo_font_face_t;
    fn cairo_ft_font_face_set_synthesize(face: *mut cairo::ffi::cairo_font_face_t, flags: u32);
}

/// A second owner of `face`. Not `FontFace::clone`: without cairo-rs's `use_glib` feature (0.22.9)
/// that clone skips `cairo_font_face_reference`, so dropping a clone frees the cached face.
fn share(face: &cairo::FontFace) -> cairo::FontFace {
    // SAFETY: takes the reference that `from_raw_full` then owns.
    unsafe {
        cairo::ffi::cairo_font_face_reference(face.to_raw_none());
        cairo::FontFace::from_raw_full(face.to_raw_none())
    }
}

/// What outlives a page: font faces (with the blob their FT_Face reads) and image surfaces.
pub struct Caches {
    ft: *mut c_void,
    fonts: HashMap<(u64, u32, bool), (cairo::FontFace, peniko::Blob<u8>)>,
    images: HashMap<u64, ImageSurface>,
}

impl Default for Caches {
    fn default() -> Self {
        Self::new()
    }
}

impl Caches {
    pub fn new() -> Caches {
        let mut ft = std::ptr::null_mut();
        // SAFETY: one FreeType library for the process.
        assert_eq!(unsafe { FT_Init_FreeType(&mut ft) }, 0, "FreeType");
        Caches {
            ft,
            fonts: HashMap::new(),
            images: HashMap::new(),
        }
    }

    /// A new chapter document: its images are new blobs, so the old ones go.
    pub fn new_chapter(&mut self) {
        self.images.clear();
        eprintln!("cairo caches: {} font faces", self.fonts.len());
    }

    fn font(&mut self, font: &FontData, bold: bool) -> Option<cairo::FontFace> {
        // By content: each chapter document hands over the same font files as new blobs.
        let bytes = font.data.data();
        let key = {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            bytes[..bytes.len().min(4096)].hash(&mut h);
            bytes[bytes.len().saturating_sub(4096)..].hash(&mut h);
            (h.finish() ^ bytes.len() as u64, font.index, bold)
        };
        if let Some((face, _)) = self.fonts.get(&key) {
            return Some(share(face));
        }
        let mut ft_face = std::ptr::null_mut();
        // SAFETY: the blob is kept alive in the cache entry next to the face reading it.
        let face = unsafe {
            if FT_New_Memory_Face(
                self.ft,
                bytes.as_ptr(),
                bytes.len() as _,
                font.index as _,
                &mut ft_face,
            ) != 0
            {
                return None;
            }
            let raw = cairo_ft_font_face_create_for_ft_face(ft_face, 0);
            if bold {
                cairo_ft_font_face_set_synthesize(raw, 1); // CAIRO_FT_SYNTHESIZE_BOLD
            }
            cairo::FontFace::from_raw_full(raw)
        };
        self.fonts.insert(key, (share(&face), font.data.clone()));
        Some(face)
    }

    fn image(&mut self, img: &peniko::ImageData) -> Option<ImageSurface> {
        if let Some(s) = self.images.get(&img.data.id()) {
            return Some(s.clone());
        }
        let (w, h) = (img.width as i32, img.height as i32);
        let mut s = ImageSurface::create(Format::ARgb32, w, h).ok()?;
        let stride = s.stride() as usize;
        {
            let mut out = s.data().ok()?;
            let src = img.data.data();
            for y in 0..h as usize {
                for x in 0..w as usize {
                    let i = (y * w as usize + x) * 4;
                    let (r, g, b, a) = match img.format {
                        ImageFormat::Rgba8 => (src[i], src[i + 1], src[i + 2], src[i + 3]),
                        _ => (src[i + 2], src[i + 1], src[i], src[i + 3]),
                    };
                    let pm = |c: u8| match img.alpha_type {
                        ImageAlphaType::Alpha => ((u16::from(c) * u16::from(a) + 127) / 255) as u8,
                        _ => c,
                    };
                    // cairo ARGB32: native-endian u32, premultiplied.
                    let v = u32::from(a) << 24
                        | u32::from(pm(r)) << 16
                        | u32::from(pm(g)) << 8
                        | u32::from(pm(b));
                    out[y * stride + x * 4..y * stride + x * 4 + 4]
                        .copy_from_slice(&v.to_ne_bytes());
                }
            }
        }
        s.mark_dirty();
        self.images.insert(img.data.id(), s.clone());
        Some(s)
    }
}

pub struct CairoScene<'a> {
    pub cr: Context,
    pub caches: &'a mut Caches,
    /// Per pushed layer: whether it opened a group (alpha/blend), and its blend operator.
    layers: Vec<Option<(f32, Operator)>>,
}

impl<'a> CairoScene<'a> {
    pub fn new(cr: Context, caches: &'a mut Caches) -> Self {
        CairoScene {
            cr,
            caches,
            layers: Vec::new(),
        }
    }

    fn matrix(a: Affine) -> Matrix {
        let [xx, yx, xy, yy, x0, y0] = a.as_coeffs();
        Matrix::new(xx, yx, xy, yy, x0, y0)
    }

    fn path(&self, shape: &impl Shape) {
        let cr = &self.cr;
        cr.new_path();
        if let Some(r) = shape.as_rect() {
            cr.rectangle(r.x0, r.y0, r.width(), r.height());
            return;
        }
        let mut last = (0.0, 0.0);
        for el in shape.path_elements(TOLERANCE) {
            match el {
                PathEl::MoveTo(p) => {
                    cr.move_to(p.x, p.y);
                    last = (p.x, p.y);
                }
                PathEl::LineTo(p) => {
                    cr.line_to(p.x, p.y);
                    last = (p.x, p.y);
                }
                PathEl::QuadTo(c, p) => {
                    let (x0, y0) = last;
                    cr.curve_to(
                        x0 + 2.0 / 3.0 * (c.x - x0),
                        y0 + 2.0 / 3.0 * (c.y - y0),
                        p.x + 2.0 / 3.0 * (c.x - p.x),
                        p.y + 2.0 / 3.0 * (c.y - p.y),
                        p.x,
                        p.y,
                    );
                    last = (p.x, p.y);
                }
                PathEl::CurveTo(c1, c2, p) => {
                    cr.curve_to(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
                    last = (p.x, p.y);
                }
                PathEl::ClosePath => cr.close_path(),
            }
        }
    }

    fn fill_rule(fill: Fill) -> FillRule {
        match fill {
            Fill::NonZero => FillRule::Winding,
            Fill::EvenOdd => FillRule::EvenOdd,
        }
    }

    fn rgba(c: Color) -> (f64, f64, f64, f64) {
        let [r, g, b, a] = c.components;
        (f64::from(r), f64::from(g), f64::from(b), f64::from(a))
    }

    fn extend(e: Extend) -> CExtend {
        match e {
            Extend::Pad => CExtend::Pad,
            Extend::Repeat => CExtend::Repeat,
            Extend::Reflect => CExtend::Reflect,
        }
    }

    /// Sets the source; returns false when there is nothing to draw.
    fn source(&mut self, paint: PaintRef<'_>, brush_transform: Option<Affine>) -> bool {
        let bt = brush_transform.map(|t| Self::matrix(t.inverse()));
        match paint {
            Paint::Solid(c) => {
                let (r, g, b, a) = Self::rgba(c);
                self.cr.set_source_rgba(r, g, b, a);
                a > 0.0
            }
            Paint::Gradient(gr) => {
                let stops = |p: &cairo::Gradient| {
                    for s in gr.stops.iter() {
                        let (r, g, b, a) = Self::rgba(s.color.to_alpha_color());
                        p.add_color_stop_rgba(f64::from(s.offset), r, g, b, a);
                    }
                    p.set_extend(Self::extend(gr.extend));
                    if let Some(m) = bt {
                        p.set_matrix(m);
                    }
                };
                match &gr.kind {
                    GradientKind::Linear(l) => {
                        let p = cairo::LinearGradient::new(l.start.x, l.start.y, l.end.x, l.end.y);
                        stops(&p);
                        let _ = self.cr.set_source(&p);
                    }
                    GradientKind::Radial(r) => {
                        let p = cairo::RadialGradient::new(
                            r.start_center.x,
                            r.start_center.y,
                            f64::from(r.start_radius),
                            r.end_center.x,
                            r.end_center.y,
                            f64::from(r.end_radius),
                        );
                        stops(&p);
                        let _ = self.cr.set_source(&p);
                    }
                    GradientKind::Sweep(_) => {
                        let Some(s) = gr.stops.first() else {
                            return false;
                        };
                        let (r, g, b, a) = Self::rgba(s.color.to_alpha_color());
                        self.cr.set_source_rgba(r, g, b, a);
                    }
                }
                true
            }
            Paint::Image(img) => {
                let Some(surface) = self.caches.image(img.image) else {
                    return false;
                };
                let p = cairo::SurfacePattern::create(&surface);
                p.set_extend(Self::extend(img.sampler.x_extend));
                p.set_filter(match img.sampler.quality {
                    ImageQuality::Low => cairo::Filter::Fast,
                    ImageQuality::Medium => cairo::Filter::Good,
                    ImageQuality::High => cairo::Filter::Best,
                });
                if let Some(m) = bt {
                    p.set_matrix(m);
                }
                let _ = self.cr.set_source(&p);
                img.sampler.alpha > 0.0
            }
            Paint::Resource(_) | Paint::Custom(_) => false,
        }
    }

    fn operator(blend: BlendMode) -> Operator {
        match blend.mix {
            Mix::Multiply => Operator::Multiply,
            Mix::Screen => Operator::Screen,
            Mix::Overlay => Operator::Overlay,
            Mix::Darken => Operator::Darken,
            Mix::Lighten => Operator::Lighten,
            Mix::Difference => Operator::Difference,
            Mix::Exclusion => Operator::Exclusion,
            _ => match blend.compose {
                Compose::Clear => Operator::Clear,
                Compose::Copy => Operator::Source,
                Compose::SrcIn => Operator::In,
                Compose::DestIn => Operator::DestIn,
                Compose::SrcOut => Operator::Out,
                Compose::DestOut => Operator::DestOut,
                _ => Operator::Over,
            },
        }
    }
}

impl RenderContext for CairoScene<'_> {}

impl PaintScene for CairoScene<'_> {
    fn reset(&mut self) {
        while !self.layers.is_empty() {
            self.pop_layer();
        }
    }

    fn push_layer(
        &mut self,
        fill: Fill,
        blend: impl Into<BlendMode>,
        alpha: f32,
        transform: Affine,
        clip: &impl Shape,
        _filter: Option<Arc<Filter>>,
        _backdrop_filter: Option<Arc<Filter>>,
    ) {
        let op = Self::operator(blend.into());
        let _ = self.cr.save();
        self.cr.set_matrix(Self::matrix(transform));
        self.path(clip);
        self.cr.set_fill_rule(Self::fill_rule(fill));
        self.cr.clip();
        // Always an isolated group, as anyrender layers are: an inner layer with another blend
        // (an inset box-shadow's `DestOut` hole) must composite onto this layer, not onto what is
        // under it. Clip-only layers (`push_clip_layer`) stay plain clips.
        self.cr.push_group();
        self.layers.push(Some((alpha, op)));
    }

    fn push_clip_layer(&mut self, fill: Fill, transform: Affine, clip: &impl Shape) {
        let _ = self.cr.save();
        self.cr.set_matrix(Self::matrix(transform));
        self.path(clip);
        self.cr.set_fill_rule(Self::fill_rule(fill));
        self.cr.clip();
        self.layers.push(None);
    }

    fn pop_layer(&mut self) {
        let Some(group) = self.layers.pop() else {
            return;
        };
        if let Some((alpha, op)) = group {
            let _ = self.cr.pop_group_to_source();
            self.cr.set_operator(op);
            let _ = self.cr.paint_with_alpha(f64::from(alpha));
        }
        let _ = self.cr.restore();
    }

    fn stroke<'b>(
        &mut self,
        style: &Stroke,
        transform: Affine,
        brush: impl Into<PaintRef<'b>>,
        brush_transform: Option<Affine>,
        shape: &impl Shape,
    ) {
        self.cr.set_matrix(Self::matrix(transform));
        if !self.source(brush.into(), brush_transform) {
            return;
        }
        let cr = &self.cr;
        cr.set_operator(Operator::Over);
        cr.set_line_width(style.width);
        cr.set_line_join(match style.join {
            Join::Bevel => LineJoin::Bevel,
            Join::Miter => LineJoin::Miter,
            Join::Round => LineJoin::Round,
        });
        cr.set_miter_limit(style.miter_limit);
        cr.set_line_cap(match style.start_cap {
            Cap::Butt => LineCap::Butt,
            Cap::Square => LineCap::Square,
            Cap::Round => LineCap::Round,
        });
        cr.set_dash(&style.dash_pattern, style.dash_offset);
        self.path(shape);
        let _ = self.cr.stroke();
    }

    fn fill<'b>(
        &mut self,
        style: Fill,
        transform: Affine,
        brush: impl Into<PaintRef<'b>>,
        brush_transform: Option<Affine>,
        shape: &impl Shape,
    ) {
        self.cr.set_matrix(Self::matrix(transform));
        let paint = brush.into();
        let image_alpha = match &paint {
            Paint::Image(i) => i.sampler.alpha,
            _ => 1.0,
        };
        if !self.source(paint, brush_transform) {
            return;
        }
        self.cr.set_operator(Operator::Over);
        self.cr.set_fill_rule(Self::fill_rule(style));
        self.path(shape);
        if image_alpha < 1.0 {
            let _ = self.cr.save();
            self.cr.clip();
            let _ = self.cr.paint_with_alpha(f64::from(image_alpha));
            let _ = self.cr.restore();
        } else {
            let _ = self.cr.fill();
        }
    }

    fn draw_glyphs<'b, 's: 'b>(
        &'s mut self,
        font: &'b FontData,
        font_size: f32,
        hint: bool,
        _normalized_coords: &'b [NormalizedCoord],
        embolden: peniko::kurbo::Vec2,
        style: impl Into<StyleRef<'b>>,
        brush: impl Into<PaintRef<'b>>,
        brush_alpha: f32,
        transform: Affine,
        glyph_transform: Option<Affine>,
        glyphs: impl Iterator<Item = Glyph> + Clone,
    ) {
        let Some(face) = self.caches.font(font, embolden.x > 0.0 || embolden.y > 0.0) else {
            return;
        };
        self.cr.set_matrix(Self::matrix(transform));
        if !self.source(brush.into(), None) {
            return;
        }
        let cr = &self.cr;
        cr.set_operator(Operator::Over);
        cr.set_font_face(&face);
        let size = Matrix::new(
            f64::from(font_size),
            0.0,
            0.0,
            f64::from(font_size),
            0.0,
            0.0,
        );
        cr.set_font_matrix(match glyph_transform {
            Some(g) => Matrix::multiply(&size, &Self::matrix(g)),
            None => size,
        });
        let mut opts = cairo::FontOptions::new().unwrap();
        opts.set_antialias(cairo::Antialias::Gray);
        opts.set_hint_style(if hint {
            cairo::HintStyle::Slight
        } else {
            cairo::HintStyle::None
        });
        opts.set_hint_metrics(cairo::HintMetrics::Off);
        cr.set_font_options(&opts);
        let run: Vec<cairo::Glyph> = glyphs
            .map(|g| cairo::Glyph::new(u64::from(g.id) as _, f64::from(g.x), f64::from(g.y)))
            .collect();
        match style.into() {
            StyleRef::Fill(_) if brush_alpha >= 1.0 => {
                let _ = cr.show_glyphs(&run);
            }
            StyleRef::Fill(_) => {
                cr.push_group();
                let _ = cr.show_glyphs(&run);
                let _ = cr.pop_group_to_source();
                let _ = cr.paint_with_alpha(f64::from(brush_alpha));
            }
            StyleRef::Stroke(s) => {
                cr.new_path();
                cr.glyph_path(&run);
                cr.set_line_width(s.width);
                let _ = cr.stroke();
            }
        }
    }

    fn draw_box_shadow(
        &mut self,
        transform: Affine,
        rect: Rect,
        color: Color,
        radius: f64,
        _std_dev: f64,
    ) {
        self.cr.set_matrix(Self::matrix(transform));
        let (r, g, b, a) = Self::rgba(color);
        if a <= 0.0 {
            return;
        }
        self.cr.set_source_rgba(r, g, b, a);
        self.cr.set_operator(Operator::Over);
        self.path(&rect.to_rounded_rect(radius));
        let _ = self.cr.fill();
    }
}
