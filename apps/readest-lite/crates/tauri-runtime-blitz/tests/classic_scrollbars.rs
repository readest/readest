//! Scroll containers show classic scrollbars, as readest-app's reference (Chromium on Linux)
//! does: a 15px gutter (10px for `scrollbar-width: thin`, none for `none`) taken from the
//! scrollport when `overflow` is `scroll`, or `auto` and the content overflows that axis, with a
//! button at each end holding an arrow and a rounded thumb between, in `scrollbar-color`'s thumb
//! colour on its track colour. A shrink-to-fit scroller grows by its gutter, so a dropdown menu
//! that scrolls keeps its items' width. Lite drew no scrollbars and reserved no space, so
//! Readest's dialogs and menus laid their content 15px wider. Expected values are Chromium's.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const STYLE: &str = r#"
:root { scrollbar-color: color-mix(in oklch, currentColor 35%, #0000) #0000; }
body { margin: 0; }
.b { position: absolute; top: 10px; width: 100px; height: 200px; }
"#;

const BODY: &str = r#"
<div class="b" id="v" style="left:10px; overflow:auto"><div style="height:600px"></div></div>
<div class="b" id="fits" style="left:130px; overflow:auto"><div style="height:100px"></div></div>
<div class="b" id="h" style="left:250px; overflow:auto"><div style="width:400px; height:50px"></div></div>
<div class="b" id="both" style="left:370px; overflow:auto"><div style="width:400px; height:600px"></div></div>
<div class="b" id="scroll" style="left:490px; overflow-y:scroll"><div style="height:50px"></div></div>
<div class="b" id="thin" style="left:610px; overflow:auto; scrollbar-width:thin"><div style="height:600px"></div></div>
<div class="b" id="none" style="left:730px; overflow:auto; scrollbar-width:none"><div style="height:600px"></div></div>
<div id="menu" style="position:absolute; left:850px; top:10px; max-height:100px; overflow-y:auto"><div style="width:80px; height:300px"></div></div>
<div id="wrap" style="position:absolute; left:10px; top:250px; width:100px; height:100px; overflow-y:auto"><span style="display:inline-block; vertical-align:top; width:90px; height:60px"></span><span style="display:inline-block; vertical-align:top; width:90px; height:60px"></span></div>
"#;

#[test]
fn scrollbars_take_their_gutter_from_the_scrollport() {
    let html = format!(
        "<!DOCTYPE html><html><head><style>{STYLE}</style></head><body>{BODY}</body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(1000, 400, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const e of document.querySelectorAll('[id]'))
            console.log([e.id, e.offsetWidth, e.offsetHeight, e.clientWidth, e.clientHeight, e.scrollWidth, e.scrollHeight].join(' '));",
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
            "v 100 200 85 200 85 600",
            "fits 100 200 100 200 100 200",
            "h 100 200 100 185 400 185",
            "both 100 200 85 185 400 600",
            "scroll 100 200 85 200 85 200",
            "thin 100 200 90 200 90 600",
            "none 100 200 100 200 100 600",
            "menu 95 100 80 100 80 300",
            "wrap 100 100 85 85 90 120",
        ]
    );
}

/// Runs of consecutive values.
fn runs(values: impl Iterator<Item = usize>) -> Vec<(usize, usize)> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    for v in values {
        match runs.last_mut() {
            Some(last) if last.1 + 1 == v => last.1 = v,
            _ => runs.push((v, v)),
        }
    }
    runs
}

#[test]
fn a_scrollbar_draws_its_arrows_and_thumb() {
    // At the Kindle's scale of 2, as Chromium draws them at a real (not emulated) device scale.
    // A vertical scroller at (10, 10), 100x200 CSS px, scrolled 133px down (its gutter is device
    // columns 190 to 219, rows 20 to 419), a horizontal one at (130, 10) (its gutter is device
    // rows 390 to 419, columns 260 to 459), and a thin one at (250, 10) so long that its thumb is
    // the shortest (its gutter is device columns 680 to 699).
    let html = "<!DOCTYPE html><html><head><style>:root { scrollbar-color: color-mix(in oklch, currentColor 35%, #0000) #0000 } \
        body { margin: 0; background: white; color: black }</style></head><body>\
        <div id='v' style='position:absolute; left:10px; top:10px; width:100px; height:200px; overflow:auto'><div style='height:600px'></div></div>\
        <div style='position:absolute; left:130px; top:10px; width:100px; height:200px; overflow:auto'><div style='width:300px; height:50px'></div></div>\
        <div style='position:absolute; left:250px; top:10px; width:100px; height:200px; overflow:auto; scrollbar-width:thin'><div style='height:30000px'></div></div>\
        </body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(720, 440, 2.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval("document.getElementById('v').scrollTop = 133", "test");
    doc.inner_mut().resolve(0.0);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 720, 440).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let page = Rect::new(0.0, 0.0, 720.0, 440.0);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &page);
        paint_scene(&mut scene, &mut doc.inner_mut(), 2.0, 720, 440, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    // Chromium draws them 35% black on white: (166, 166, 166).
    let dark = |x: usize, y: usize| data[y * stride + x * 4 + 1] < 200;
    let row = |y: usize| runs((180..230).filter(|&x| dark(x, y)));
    // The up arrow's tip, middle and base, the thumb, the down arrow's base and tip.
    assert_eq!(
        [32, 36, 40, 150, 399, 407].map(row),
        [
            vec![(204, 205)],
            vec![(200, 209)],
            vec![(196, 213)],
            vec![(196, 213)],
            vec![(196, 213)],
            vec![(204, 205)],
        ]
    );
    // Down the middle: the up arrow, the thumb (a third of the track, a third of the way down),
    // the down arrow.
    assert_eq!(
        runs((0..440).filter(|&y| dark(205, y))),
        [(32, 40), (128, 236), (399, 407)]
    );
    // Along the horizontal one: the left arrow, the thumb, the right arrow.
    assert_eq!(
        runs((240..480).filter(|&x| dark(x, 405))),
        [(271, 279), (296, 338), (440, 448)]
    );
    // Down the middle of the thin one: its arrows and its shortest thumb.
    assert_eq!(
        runs((0..440).filter(|&y| dark(690, y))),
        [(29, 34), (44, 65), (405, 410)]
    );
}
