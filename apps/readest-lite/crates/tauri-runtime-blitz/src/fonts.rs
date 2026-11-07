//! Bundled fonts instead of fontconfig: `bundled(DIR)` registers every .ttf/.otf/.ttc in DIR.
//! Files are memory-mapped (registering only parses each face's name table, so a 20 MB CJK
//! collection costs a few pages); `BLITZ_FONTS_READ=1` reads them whole instead, for comparison.
//!
//! Generic families by file name: `*Mono*` monospace, `*Serif*` serif, the rest sans-serif. Files
//! with `CJK` in the name are not primary: their families come second in sans-serif/serif and are
//! the script fallback for Han, kana, Hangul and Bopomofo, ordered JP, SC, TC, HK, KR (KR first
//! for Hangul). No per-locale fallbacks.

use std::sync::Arc;

use fontique::{
    Blob, Collection, CollectionOptions, FamilyId, GenericFamily as G, Script, SourceCache,
};

fn push(to: &mut Vec<FamilyId>, ids: &[FamilyId]) {
    for id in ids {
        if !to.contains(id) {
            to.push(*id);
        }
    }
}

pub fn bundled(dir: &str) -> blitz_dom::FontContext {
    let read = std::env::var("BLITZ_FONTS_READ").is_ok_and(|v| v == "1");
    let mut collection = Collection::new(CollectionOptions {
        shared: false,
        system_fonts: false,
    });
    collection.register_fonts(Blob::new(Arc::new(blitz_dom::BULLET_FONT) as _), None);
    let (mut sans, mut serif, mut mono) = (Vec::new(), Vec::new(), Vec::new());
    let (mut cjk_sans, mut cjk_serif) = (Vec::new(), Vec::new());
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| Some(e.ok()?.path()))
        .collect();
    files.sort();
    for f in files {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        if !(name.ends_with(".ttf") || name.ends_with(".otf") || name.ends_with(".ttc")) {
            continue;
        }
        let blob: Blob<u8> = if read {
            Blob::from(std::fs::read(&f).unwrap())
        } else {
            let file = std::fs::File::open(&f).unwrap();
            // SAFETY: the font files are not modified while the app runs.
            Blob::new(Arc::new(unsafe { memmap2::Mmap::map(&file).unwrap() }))
        };
        let ids: Vec<FamilyId> = collection
            .register_fonts(blob, None)
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        // A CJK collection holds Mono families too ("Noto Sans Mono CJK JP"); keep those out of
        // the fallbacks.
        let (plain, monos): (Vec<_>, Vec<_>) = ids.iter().partition(|&&id| {
            !collection
                .family_name(id)
                .is_some_and(|n| n.contains("Mono"))
        });
        if name.contains("CJK") {
            push(
                if name.contains("Serif") {
                    &mut cjk_serif
                } else {
                    &mut cjk_sans
                },
                &plain,
            );
            push(&mut mono, &monos);
        } else if name.contains("Mono") {
            push(&mut mono, &ids);
        } else if name.contains("Serif") {
            push(&mut serif, &ids);
        } else {
            push(&mut sans, &ids);
        }
    }
    let rank = |c: &mut Collection, ids: &mut Vec<FamilyId>, order: &[&str]| {
        let key = |c: &mut Collection, id: FamilyId| {
            let n = c.family_name(id).unwrap_or_default().to_owned();
            order
                .iter()
                .position(|o| n.ends_with(o))
                .unwrap_or(order.len())
        };
        let mut keyed: Vec<_> = ids.iter().map(|&id| (key(c, id), id)).collect();
        keyed.sort_by_key(|k| k.0);
        *ids = keyed.into_iter().map(|k| k.1).collect();
    };
    let ja = ["JP", "SC", "TC", "HK", "KR"];
    let ko = ["KR", "JP", "SC", "TC", "HK"];
    rank(&mut collection, &mut cjk_sans, &ja);
    rank(&mut collection, &mut cjk_serif, &ja);
    // The first CJK family of each kind joins the generic lists, so serif text keeps a serif face
    // for its CJK characters.
    if let Some(&id) = cjk_sans.first() {
        push(&mut sans, &[id]);
    }
    if let Some(&id) = cjk_serif.first() {
        push(&mut serif, &[id]);
    }
    for g in [G::Serif, G::UiSerif] {
        collection.set_generic_families(g, serif.iter().copied());
    }
    for g in [G::Monospace, G::UiMonospace] {
        collection.set_generic_families(g, mono.iter().copied());
    }
    for g in [
        G::SansSerif,
        G::SystemUi,
        G::UiSansSerif,
        G::UiRounded,
        G::Cursive,
        G::Fantasy,
        G::Emoji,
        G::Math,
        G::FangSong,
    ] {
        collection.set_generic_families(g, sans.iter().copied());
    }
    let mut fallback = cjk_sans.clone();
    push(&mut fallback, &cjk_serif);
    for s in [b"Hani", b"Hira", b"Kana", b"Bopo"] {
        collection.set_fallbacks(Script::from_bytes(*s), fallback.iter().copied());
    }
    let mut korean = fallback.clone();
    rank(&mut collection, &mut korean, &ko);
    collection.set_fallbacks(Script::from_bytes(*b"Hang"), korean.iter().copied());
    blitz_dom::FontContext {
        collection,
        source_cache: SourceCache::new_shared(),
    }
}
