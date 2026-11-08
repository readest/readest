//! Web fonts as Readest ships them: its UI font (Inter) is a WOFF2 file named by `@font-face`.
//! The fixture is DejaVu Sans Mono cut down to "MW".

#[test]
fn woff2_fonts_decode() {
    let bytes = include_bytes!("fixtures/mono-mw.woff2");
    assert_eq!(&bytes[..4], b"wOF2");
    let sfnt = blitz_dom::decode_font_bytes(bytes);
    assert_eq!(&sfnt[..4], [0, 1, 0, 0], "a TrueType font, not the WOFF2 bytes");
}
