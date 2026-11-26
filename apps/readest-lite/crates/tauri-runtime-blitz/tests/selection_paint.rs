//! Script's selection is the one painted. Readest selects a word on a long press or a double tap
//! (and with its own handles) through `Selection.addRange`, which Lite kept in JS: Blitz painted
//! none, so on the Kindle a selected word showed nothing. Readest's e-ink `::selection` swaps the
//! theme's colors: white text on black.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const W: u32 = 300;
const H: u32 = 60;

/// The page's RGB pixels after `script` ran, and the box of its `<b>` (device px, scale 1).
fn painted(style: &str, script: &str) -> (Vec<Vec<[u8; 3]>>, (usize, usize, usize, usize)) {
    let html = format!(
        "<!DOCTYPE html><html><head><style>{style}</style></head>\
         <body style='margin:0; font-size:20px'><p id='p' style='margin:10px'>Sein \
         <b>Zimmer</b>, ein richtiges</p></body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(script, "test");
    doc.inner_mut().resolve(0.0);
    let word = {
        let d = doc.inner();
        let b = d.query_selector("b").unwrap().unwrap();
        let r = d.get_client_bounding_rect(b).unwrap();
        let (x0, y0) = (r.x.floor() as usize, r.y.floor() as usize);
        (x0, y0, (r.x + r.width).ceil() as usize, (r.y + r.height).ceil() as usize)
    };
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, W as i32, H as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, W as f64, H as f64);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, W, H, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    let px = (0..H as usize)
        .map(|y| {
            (0..W as usize)
                .map(|x| {
                    let p = &data[y * stride + x * 4..];
                    [p[2], p[1], p[0]]
                })
                .collect()
        })
        .collect();
    (px, word)
}

const SELECT_WORD: &str = "const t = document.querySelector('b').firstChild;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 6);
    getSelection().addRange(r);";

/// How many pixels of `px` inside (`true`) or outside the box match `f`.
fn count(
    px: &[Vec<[u8; 3]>],
    (x0, y0, x1, y1): (usize, usize, usize, usize),
    inside: bool,
    f: impl Fn([u8; 3]) -> bool,
) -> usize {
    let within = |x, y| (x0..x1).contains(&x) && (y0..y1).contains(&y);
    px.iter()
        .enumerate()
        .flat_map(|(y, row)| row.iter().enumerate().map(move |(x, p)| (x, y, *p)))
        .filter(|&(x, y, p)| within(x, y) == inside && f(p))
        .count()
}

const BLITZ_SELECTION: [u8; 3] = [180, 213, 255];

#[test]
fn a_word_script_selects_is_painted_selected() {
    let (px, word) = painted("", SELECT_WORD);
    let area = (word.2 - word.0) * (word.3 - word.1);
    let selected = count(&px, word, true, |p| p == BLITZ_SELECTION);
    assert!(selected > area / 3, "{selected} of {area} pixels of the word selected");
    assert_eq!(count(&px, word, false, |p| p == BLITZ_SELECTION), 0);
}

#[test]
fn a_selection_in_e_ink_colors_is_white_text_on_black() {
    let style = "::selection { color: white; background: black }";
    let (plain, word) = painted(style, "");
    let (px, _) = painted(style, SELECT_WORD);
    let dark = |p: [u8; 3]| p.iter().all(|&c| c < 64);
    let area = (word.2 - word.0) * (word.3 - word.1);
    assert!(count(&px, word, true, dark) > area / 2, "the word's box is black");
    // where the word's ink was, the selection shows it white
    let ink: Vec<_> = (word.1..word.3)
        .flat_map(|y| (word.0..word.2).map(move |x| (x, y)))
        .filter(|&(x, y)| dark(plain[y][x]))
        .collect();
    let white = ink.iter().filter(|&&(x, y)| px[y][x].iter().all(|&c| c > 192)).count();
    assert!(white * 10 > ink.len() * 8, "{white} of the word's {} ink pixels white", ink.len());
}

#[test]
fn removing_the_ranges_unpaints_the_selection() {
    let (plain, _) = painted("", "");
    let (px, _) = painted("", &format!("{SELECT_WORD} getSelection().removeAllRanges();"));
    assert!(px == plain);
}

// A range from (p, 1) to (p, 2) selects the <b>: the text it holds is painted selected.
#[test]
fn a_range_between_elements_paints_the_text_it_holds() {
    let (px, word) = painted(
        "",
        "const p = document.getElementById('p'); const r = document.createRange();
         r.setStart(p, 1); r.setEnd(p, 2); getSelection().addRange(r);",
    );
    let area = (word.2 - word.0) * (word.3 - word.1);
    assert!(count(&px, word, true, |p| p == BLITZ_SELECTION) > area / 3);
    assert_eq!(count(&px, word, false, |p| p == BLITZ_SELECTION), 0);
}
