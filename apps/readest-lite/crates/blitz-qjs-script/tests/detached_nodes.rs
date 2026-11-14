//! Nodes out of the document that nothing in JS reaches are freed at the next collection, with
//! what they hold (a section's decoded images). Readest unmounts whole pages (the library when a
//! book opens): before, every node it ever removed stayed allocated for the rest of the session.
//! Nodes in the document, and removed ones JS still holds, are kept with their listeners.

use std::sync::Arc;

use blitz_dom::net::{Resource, ResourceLoadResponse};
use blitz_dom::node::{ImageData, SpecialElementData};
use blitz_dom::util::ImageType;
use blitz_dom::{Document as _, DocumentConfig, NodeId};
use blitz_qjs_script::QjsDocument;

const PAGE: &str = r#"<!DOCTYPE html><html><head></head><body><div id="c"></div><img id="i" src="https://lite.test/cover.png"></body></html>"#;

/// Runs `script`, then its jobs and due timers, then a frame, as the host's loop does.
fn step(doc: &mut QjsDocument, script: &str) {
    doc.eval(script, "test");
    doc.run_jobs();
    doc.run_due_timers();
    doc.run_jobs();
    doc.inner_mut().resolve(0.0);
    doc.call_global("__blitzAfterLayout", ());
}

/// A collection and the jobs after it, then a frame.
fn collect(doc: &mut QjsDocument) {
    doc.run_gc();
    doc.run_jobs();
    doc.inner_mut().resolve(0.0);
}

/// The `id N` lines logged so far, as node ids.
fn ids(doc: &mut QjsDocument) -> Vec<u64> {
    doc.take_messages()
        .iter()
        .filter_map(|m| m.strip_prefix("log: id "))
        .map(|s| s.parse().unwrap())
        .collect()
}

fn allocated(doc: &QjsDocument, id: u64) -> bool {
    doc.inner().get_node(NodeId::from_u64(id)).is_some()
}

#[test]
fn a_removed_subtree_nothing_reaches_is_freed() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    step(
        &mut doc,
        "(() => {
            const s = document.createElement('section');
            s.innerHTML = '<p>a</p><p>b</p>';
            document.getElementById('c').append(s);
            console.log('id ' + s._id);
            console.log('id ' + s.firstChild._id);
        })();",
    );
    step(&mut doc, "document.querySelector('section').remove();");
    let ids = ids(&mut doc);
    collect(&mut doc);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    for id in ids {
        assert!(!allocated(&doc, id), "node {id} still allocated");
    }
}

#[test]
fn an_element_never_inserted_is_freed() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    step(
        &mut doc,
        "(() => {
            const d = document.createElement('div');
            d.innerHTML = '<b>x</b>';
            console.log('id ' + d._id);
        })();",
    );
    let ids = ids(&mut doc);
    collect(&mut doc);
    assert!(!allocated(&doc, ids[0]), "node {} still allocated", ids[0]);
}

#[test]
fn a_removed_subtree_js_still_reaches_is_kept() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    step(
        &mut doc,
        "(() => {
            const s = document.createElement('section');
            s.innerHTML = '<p>a</p><p>b</p>';
            document.getElementById('c').append(s);
            globalThis.kept = s.lastChild;
            kept.addEventListener('ping', () => console.log('ping kept'));
            console.log('id ' + s._id);
            s.remove();
        })();",
    );
    let ids = ids(&mut doc);
    collect(&mut doc);
    assert!(
        allocated(&doc, ids[0]),
        "the section of a held paragraph was freed"
    );
    step(
        &mut doc,
        "console.log(kept.textContent, kept.parentNode.localName, kept.parentNode.firstChild.textContent);
        document.body.append(kept);
        kept.dispatchEvent(new Event('ping'));
        console.log(document.body.lastChild.textContent);",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        doc.take_messages(),
        ["log: b section a", "log: ping kept", "log: b"]
    );
}

#[test]
fn listeners_and_properties_of_nodes_in_the_document_outlive_a_collection() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    step(
        &mut doc,
        "(() => {
            // Parsed with the page, made here and inserted, and removed then inserted again.
            const c = document.getElementById('c');
            c.addEventListener('ping', () => console.log('ping c'));
            c.mark = 'c';
            const b = document.createElement('button');
            b.id = 'b';
            b.addEventListener('ping', () => console.log('ping b'));
            c.append(b);
            const s = document.createElement('span');
            s.id = 's';
            s.mark = 's';
            document.body.append(s);
            s.remove();
            document.body.append(s);
        })();",
    );
    collect(&mut doc);
    step(
        &mut doc,
        "for (const id of ['c', 'b']) document.getElementById(id).dispatchEvent(new Event('ping'));
        console.log(document.getElementById('c').mark, document.getElementById('s').mark);",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        doc.take_messages(),
        ["log: ping c", "log: ping b", "log: c s"]
    );
}

#[test]
fn a_resize_observer_that_unobserved_holds_nothing() {
    // react-virtuoso only unobserves, and its observers' callbacks hold the list's scroller: the
    // library page stayed allocated for the rest of the session.
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    step(
        &mut doc,
        "(() => {
            const s = document.createElement('section');
            s.innerHTML = '<p>a</p>';
            document.getElementById('c').append(s);
            const ro = new ResizeObserver(() => s.id);
            ro.observe(s.firstChild);
            ro.unobserve(s.firstChild);
            console.log('id ' + s._id);
        })();",
    );
    step(&mut doc, "document.querySelector('section').remove();");
    let ids = ids(&mut doc);
    collect(&mut doc);
    assert!(!allocated(&doc, ids[0]), "node {} still allocated", ids[0]);
}

#[test]
fn a_removed_shadow_host_is_freed() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    step(
        &mut doc,
        "(() => {
            const h = document.createElement('div');
            document.body.append(h);
            h.attachShadow({ mode: 'open' }).innerHTML = '<p>in</p>';
            console.log('id ' + h._id);
            console.log('id ' + h.shadowRoot._id);
        })();",
    );
    step(&mut doc, "document.body.lastChild.remove();");
    let ids = ids(&mut doc);
    collect(&mut doc);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    for id in ids {
        assert!(!allocated(&doc, id), "node {id} still allocated");
    }
}

#[test]
fn a_removed_images_pixels_are_freed() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    doc.inner_mut().load_resource(ResourceLoadResponse {
        request_id: 0,
        node_id: None,
        resolved_url: Some("https://lite.test/cover.png".into()),
        result: Ok(Resource::Image(
            ImageType::Image,
            64,
            64,
            Arc::new(vec![255; 64 * 64 * 4]),
        )),
    });
    let pixels = {
        let d = doc.inner();
        let img = d.get_element_by_id("i").unwrap();
        match &d
            .get_node(img)
            .unwrap()
            .element_data()
            .unwrap()
            .special_data
        {
            SpecialElementData::Image(i) => match &**i {
                ImageData::Raster(r) => r.data.downgrade(),
                _ => panic!("not a raster image"),
            },
            _ => panic!("no image"),
        }
    };
    step(&mut doc, "document.getElementById('i').remove();");
    collect(&mut doc);
    assert!(
        pixels.upgrade().is_none(),
        "the removed <img>'s pixels are still held"
    );
}
