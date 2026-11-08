//! An SVG overlay as foliate-js's Overlayer draws highlights: an absolutely positioned `<svg>`
//! sized by CSS to its container (no viewBox, so user units are CSS px), with `<g>`/`<path>`
//! elements added by script after the page is laid out, and the highlight's opacity given by a
//! CSS variable.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const W: u32 = 200;
const H: u32 = 100;

fn load() -> QjsDocument {
    let html = "<!DOCTYPE html><html><body style='margin:0'>\
        <div id='view' style='position:relative; width:200px; height:100px'></div>\
        </body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    doc
}

/// Grey levels of the painted page.
fn paint(doc: &mut QjsDocument) -> impl Fn(usize, usize) -> u8 + use<> {
    doc.inner_mut().resolve(0.0);
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, W as i32, H as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, f64::from(W), f64::from(H));
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            Default::default(),
            &all,
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, W, H, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap().to_vec();
    move |x, y| data[y * stride + x * 4 + 1]
}

fn eval(doc: &mut QjsDocument, script: &str) {
    doc.eval(script, "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
}

/// The Overlayer's element: made and attached before anything is drawn in it.
const OVERLAYER: &str = "
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    Object.assign(svg.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    svg.append(document.createElementNS(ns, 'defs'));
    document.getElementById('view').append(svg);
";

/// A highlight from (20, 10) to (60, 30), black at the given opacity.
fn highlight(opacity: &str) -> String {
    format!(
        "const g = document.createElementNS(ns, 'g');
        g.setAttribute('fill', '#000');
        g.style.opacity = '{opacity}';
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M 20 10 L 60 10 L 60 30 L 20 30 Z');
        g.append(p);
        svg.append(g);"
    )
}

#[test]
fn paths_added_to_a_laid_out_svg_are_painted_in_css_pixels() {
    let mut doc = load();
    eval(&mut doc, OVERLAYER);
    let _ = paint(&mut doc);
    eval(&mut doc, &highlight("1"));
    let luma = paint(&mut doc);
    // inside the path, black; outside it (and right of where a scaled 100x150 tree would put
    // it), white
    assert_eq!((luma(25, 15), luma(55, 25)), (0, 0));
    assert_eq!((luma(15, 15), luma(65, 15), luma(25, 35)), (255, 255, 255));
}

#[test]
fn opacity_from_a_css_variable_applies() {
    let mut doc = load();
    eval(&mut doc, OVERLAYER);
    eval(
        &mut doc,
        &(highlight("var(--overlayer-highlight-opacity, .3)")
            + "document.getElementById('view').style.setProperty('--overlayer-highlight-opacity', '0.5');"),
    );
    let luma = paint(&mut doc);
    let mid = luma(40, 20);
    assert!(
        (120..=136).contains(&mid),
        "half-transparent black over white: {mid}"
    );
    // and the fallback when the variable is not set
    let mut doc = load();
    eval(&mut doc, OVERLAYER);
    eval(
        &mut doc,
        &highlight("var(--overlayer-highlight-opacity, .3)"),
    );
    let luma = paint(&mut doc);
    let mid = luma(40, 20);
    assert!((170..=186).contains(&mid), "30% black over white: {mid}");
}

#[test]
fn a_removed_highlight_is_no_longer_painted() {
    let mut doc = load();
    eval(&mut doc, OVERLAYER);
    eval(&mut doc, &highlight("1"));
    assert_eq!(paint(&mut doc)(40, 20), 0);
    eval(&mut doc, "g.remove();");
    assert_eq!(paint(&mut doc)(40, 20), 255);
}

#[test]
fn an_overlay_in_a_shadow_root_is_painted() {
    // foliate-js's paginator keeps its views in its shadow root
    let mut doc = load();
    eval(
        &mut doc,
        &(
            "const host = document.getElementById('view');
            host.id = '';
            const root = host.attachShadow({ mode: 'open' });
            const view = document.createElement('div');
            view.id = 'view';
            view.style.cssText = 'position:relative; width:200px; height:100px';
            root.append(view);
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            Object.assign(svg.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' });
            view.append(svg);"
        )
            .to_owned(),
    );
    let _ = paint(&mut doc);
    eval(&mut doc, &highlight("1"));
    assert_eq!(paint(&mut doc)(40, 20), 0);
}

#[test]
fn an_overlay_over_an_iframe_in_a_flex_view_is_painted() {
    // the paginator's view: a relative flex box holding the section's iframe, then the overlay
    let mut doc = load();
    eval(
        &mut doc,
        "const view = document.getElementById('view');
        view.style.display = 'flex';
        const f = document.createElement('iframe');
        f.style.cssText = 'border:0; width:200px; height:100px';
        f.srcdoc = '<body style=\"margin:0\"><p>text</p></body>';
        view.append(f);",
    );
    let _ = paint(&mut doc);
    eval(&mut doc, OVERLAYER);
    eval(&mut doc, &highlight("1"));
    assert_eq!(paint(&mut doc)(40, 20), 0);
}

#[test]
fn an_overlay_in_a_scrolled_clipping_container_is_painted() {
    // the paginator scrolls a static `overflow: hidden` container a page per turn; the view
    // (relative) and its overlay (absolute) are lifted out of it and clipped to it
    let html = "<!DOCTYPE html><html><body style='margin:0'>\
        <div id='c' style='width:200px; height:100px; overflow:hidden'>\
          <div id='view' style='position:relative; width:400px; height:100px'></div>\
        </div></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    eval(&mut doc, OVERLAYER);
    // a highlight on the second page, 200px in
    eval(
        &mut doc,
        "const g = document.createElementNS(ns, 'g');
        g.setAttribute('fill', '#000');
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M 220 10 L 260 10 L 260 30 L 220 30 Z');
        g.append(p);
        svg.append(g);",
    );
    {
        let mut d = doc.inner_mut();
        d.resolve(0.0);
        let c = d.get_element_by_id("c").unwrap();
        d.scroll_to(c, 200.0, 0.0, blitz_dom::ScrollBehavior::Instant);
    }
    let luma = paint(&mut doc);
    assert_eq!((luma(25, 15), luma(55, 25)), (0, 0));
    assert_eq!(luma(65, 15), 255);
}

#[test]
fn an_overlay_with_the_loupe_clip_path_is_painted() {
    // the Overlayer's markup: an empty loupe clipPath, then a rounded highlight
    let mut doc = load();
    eval(
        &mut doc,
        &(OVERLAYER.to_owned()
            + "const cp = document.createElementNS(ns, 'clipPath');
            cp.setAttribute('id', 'foliate-loupe-clip-1');
            cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const hole = document.createElementNS(ns, 'path');
            hole.setAttribute('clip-rule', 'evenodd');
            hole.setAttribute('fill-rule', 'evenodd');
            cp.append(hole);
            svg.firstChild.append(cp);"),
    );
    let _ = paint(&mut doc);
    eval(
        &mut doc,
        "const g = document.createElementNS(ns, 'g');
        g.setAttribute('fill', '#000');
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M 24 10 L 56 10 Q 60 10 60 14 L 60 26 Q 60 30 56 30 L 24 30 Q 20 30 20 26 L 20 14 Q 20 10 24 10 Z');
        g.append(p);
        svg.append(g);",
    );
    assert_eq!(paint(&mut doc)(40, 20), 0);
}

#[test]
fn an_svg_without_a_view_box_scales_with_the_device() {
    // at 2 device px per CSS px, the highlight's (20, 10)-(60, 30) is (40, 20)-(120, 60)
    let html = "<!DOCTYPE html><html><body style='margin:0'>\
        <div id='view' style='position:relative; width:100px; height:50px'></div></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 2.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    eval(&mut doc, &(OVERLAYER.to_owned() + &highlight("1")));
    doc.inner_mut().resolve(0.0);
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, W as i32, H as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, f64::from(W), f64::from(H));
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            Default::default(),
            &all,
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 2.0, W, H, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap().to_vec();
    let luma = |x: usize, y: usize| data[y * stride + x * 4 + 1];
    assert_eq!((luma(45, 25), luma(115, 55)), (0, 0));
    assert_eq!((luma(35, 25), luma(125, 25)), (255, 255));
}

#[test]
fn a_multiplied_highlight_keeps_the_text_under_it_dark() {
    // Readest blends highlights with `multiply`: black text under one stays black
    let mut doc = load();
    eval(
        &mut doc,
        "const ink = document.createElement('div');
        ink.style.cssText = 'position:absolute; left:30px; top:15px; width:10px; height:10px; background:#000';
        document.getElementById('view').append(ink);",
    );
    eval(&mut doc, OVERLAYER);
    eval(
        &mut doc,
        &(highlight("var(--overlayer-highlight-opacity, .3)")
            + "g.setAttribute('fill', '#808080');
            g.style.mixBlendMode = 'var(--overlayer-highlight-blend-mode, normal)';
            document.getElementById('view').style.setProperty('--overlayer-highlight-blend-mode', 'multiply');
            document.getElementById('view').style.setProperty('--overlayer-highlight-opacity', '1');"),
    );
    let luma = paint(&mut doc);
    // the ink stays black; the highlight over white is its own grey
    assert_eq!(luma(35, 20), 0);
    assert!((120..=136).contains(&luma(50, 20)), "{}", luma(50, 20));
}

#[test]
fn a_blend_mode_joins_a_style_attribute() {
    // one `style` attribute, not two (which the SVG parser rejects)
    let mut doc = load();
    eval(&mut doc, OVERLAYER);
    eval(
        &mut doc,
        &(highlight("1") + "g.setAttribute('style', 'fill: #000; mix-blend-mode: multiply');"),
    );
    assert_eq!(paint(&mut doc)(40, 20), 0);
}
