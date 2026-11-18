//! A fieldset's first `<legend>` sits on the fieldset's top border, as HTML's rendering section
//! and Chromium have it: it is as wide as its content (up to the fieldset's content box), at the
//! content box's inline start, with its border box centred on the top border when the border is
//! the thicker, and at the top otherwise. The fieldset's content starts below whichever is lower,
//! its border and background start at the legend's middle, and its top border has a gap where the
//! legend's border box crosses it. Blitz laid the legend out as an ordinary full-width block
//! inside the border; readest-app's Bookshelves editor titles its Filters, Grouping and Sorting
//! sections with legends. Expected values are Chromium's.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const STYLE: &str = r#"
* { box-sizing: border-box; }
body { margin: 0; font: 14px/20px sans-serif; width: 300px; }
fieldset { margin: 0 0 10px 0; padding: 0; border: 1px solid black; min-width: 0; }
legend { padding: 0; }
i { display: inline-block; vertical-align: top; width: 50px; height: 20px; background: blue; }
.c { height: 30px; background: #ccc; }
#f1 { border-radius: 8px; padding-inline-start: 16px; }
#f1 legend { margin-inline-start: -4px; padding: 0 4px; }
#f2 { border-width: 12px; padding: 5px 7px; }
#f2 legend { font-size: 8px; line-height: 8px; }
#f2 i { height: 8px; }
#f3 { padding: 3px 10px; }
#f3 legend { margin: 4px 6px; padding: 2px; border: 1px solid red; }
#f4 i { width: 120px; }
#f5 { direction: rtl; padding-inline-start: 16px; }
#f6 { border: 2px solid black; padding-inline-start: 16px; background: yellow; }
"#;

const BODY: &str = r#"
<fieldset id="f1"><legend><i></i></legend><div class="c"></div></fieldset>
<fieldset id="f2"><legend><i></i></legend><div class="c"></div></fieldset>
<fieldset id="f3"><legend><i></i></legend><div class="c"></div></fieldset>
<fieldset id="f4"><legend><i></i><i></i><i></i></legend><div class="c"></div></fieldset>
<fieldset id="f6"><legend><i></i></legend><div class="c"></div></fieldset>
<fieldset id="f5"><legend><i></i></legend><div class="c"></div></fieldset>
"#;

#[test]
fn legends_sit_on_the_top_border() {
    let html = format!(
        "<!DOCTYPE html><html><head><style>{STYLE}</style></head><body>{BODY}</body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 500, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].join(','); };
        for (const f of document.querySelectorAll('fieldset'))
            console.log(`${f.id} f=${r(f)} l=${r(f.querySelector('legend'))} c=${r(f.querySelector('.c'))}`);",
        "test",
    );
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        [
            "f1 f=0,0,300,51 l=13,0,58,20 c=17,20,282,30",
            "f2 f=0,61,300,64 l=19,63,50,8 c=19,78,262,30",
            "f3 f=0,135,300,67 l=17,135,56,26 c=11,168,278,30",
            "f4 f=0,212,300,71 l=1,212,298,40 c=1,252,298,30",
            "f6 f=0,293,300,52 l=18,293,50,20 c=18,313,280,30",
            "f5 f=0,355,300,51 l=233,355,50,20 c=1,375,282,30",
        ]
    );
}

const PAINT_STYLE: &str = r#"
* { box-sizing: border-box; }
body { margin: 0; font: 14px/20px sans-serif; }
fieldset { margin: 0; padding: 0 0 0 16px; border: 2px solid black; background: yellow; min-width: 0; width: 200px; }
legend { padding: 0 4px; margin-inline-start: -4px; }
i { display: inline-block; vertical-align: top; width: 50px; height: 20px; background: blue; }
.c { height: 20px; }
"#;

#[test]
fn the_border_and_background_start_at_the_legend_with_a_gap_for_it() {
    let html = format!(
        "<!DOCTYPE html><html><head><style>{PAINT_STYLE}</style></head><body><fieldset><legend><i></i></legend><div class=\"c\"></div></fieldset></body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(220, 60, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 220, 60).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let page = Rect::new(0.0, 0.0, 220.0, 60.0);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &page);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 220, 60, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    let name = |x: usize, y: usize| {
        let p = &data[y * stride + x * 4..];
        match (p[2], p[1], p[0]) {
            (0, 0, 0) => "black",
            (255, 255, 255) => "white",
            (255, 255, 0) => "yellow",
            (0, 0, 255) => "blue",
            _ => "other",
        }
    };
    let xs = [1, 5, 13, 14, 15, 17, 18, 67, 68, 71, 72, 150, 199];
    let rows: Vec<String> = [8, 9, 10, 11, 40, 41, 42]
        .iter()
        .map(|&y| format!("{y}: {}", xs.map(|x| name(x, y)).join(" ")))
        .collect();
    assert_eq!(
        rows,
        [
            "8: white white white white white white blue blue white white white white white",
            "9: black black black yellow yellow yellow blue blue yellow yellow black black black",
            "10: black black black yellow yellow yellow blue blue yellow yellow black black black",
            "11: black yellow yellow yellow yellow yellow blue blue yellow yellow yellow yellow black",
            "40: black black black black black black black black black black black black black",
            "41: black black black black black black black black black black black black black",
            "42: white white white white white white white white white white white white white",
        ]
    );
}
