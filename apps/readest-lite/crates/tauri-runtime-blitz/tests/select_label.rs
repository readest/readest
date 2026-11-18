//! A drop-down `<select>` shows its selected option's label: the option carrying `selected`, or
//! else its first enabled option. readest-app's settings rows (Language, TTS Text, Translation
//! Service...) are `<select>`s sized to their label (`field-sizing: content`); Blitz drew no label
//! in them, so on the Kindle they showed only the arrow beside them.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

type Box4 = Option<(usize, usize, usize, usize)>;

/// The bounding box (x0, y0, x1, y1) of the red pixels cairo paints for `body` on white
/// (300x60), after `script` runs when there is one.
fn red_box(body: &str, script: Option<&str>) -> Box4 {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 60, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    if let Some(script) = script {
        paint(&mut doc);
        doc.eval(script, "test");
        doc.inner_mut().resolve(0.0);
    }
    paint(&mut doc)
}

fn paint(doc: &mut QjsDocument) -> Box4 {
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 300, 60).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, 300.0, 60.0);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 300, 60, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    let mut b: Box4 = None;
    for y in 0..60 {
        for x in 0..300 {
            let p = &data[y * stride + x * 4..];
            if p[2] > 200 && p[1] < 100 && p[0] < 100 {
                b = Some(b.map_or((x, y, x, y), |(x0, y0, x1, y1)| {
                    (x0.min(x), y0.min(y), x1.max(x), y1.max(y))
                }));
            }
        }
    }
    b
}

const STYLE: &str = "font: 20px sans-serif; color: red; border: 0; padding: 0; margin: 0";

/// A `<select>` holding `options`, its label drawn as the text `label` would be.
fn select_and_text(options: &str, label: &str) -> (String, String) {
    (
        format!("<select id='s' style='{STYLE}'>{options}</select>"),
        format!("<span style='{STYLE}'>{label}</span>"),
    )
}

#[test]
fn a_select_shows_its_selected_option() {
    let (select, text) = select_and_text(
        "<option value='a'>Wide label</option><option value='b' selected>Narrow</option>",
        "Narrow",
    );
    let label = red_box(&select, None).expect("the label is drawn");
    assert_eq!(Some(label), red_box(&text, None));
}

#[test]
fn a_select_without_a_selected_option_shows_its_first_enabled_one() {
    let (select, text) = select_and_text(
        "<option disabled>Disabled</option><option>First enabled</option><option>Last</option>",
        "First enabled",
    );
    assert_eq!(red_box(&select, None), red_box(&text, None));
}

#[test]
fn a_select_shows_the_option_script_selects() {
    let (select, text) = select_and_text(
        "<option value='a'>English</option><option value='b'>System Language</option>",
        "System Language",
    );
    let script = "document.getElementById('s').value = 'b'";
    assert_eq!(red_box(&select, Some(script)), red_box(&text, None));
}

#[test]
fn a_select_shows_its_option_s_new_text() {
    let (select, text) = select_and_text("<option id='o' selected>English</option>", "Anglais");
    let script = "document.getElementById('o').textContent = 'Anglais'";
    assert_eq!(red_box(&select, Some(script)), red_box(&text, None));
}
