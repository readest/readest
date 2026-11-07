//! The native side: `__n.*` functions over `blitz-dom` node ids, called by `bootstrap.js`.
//! Ids cross as numbers; absent nodes are `null`.

use std::{cell::RefCell, rc::Rc};

use blitz_dom::{BaseDocument, LocalName, Namespace, NodeId, QualName, node::NodeData};
use rquickjs::{Ctx, Function, Object};
use url::Url;

use crate::Shared;

const HTML_NS: &str = "http://www.w3.org/1999/xhtml";

fn qual(ns: &str, local: &str) -> QualName {
    let ns = if ns.is_empty() { HTML_NS } else { ns };
    QualName::new(None, Namespace::from(ns), LocalName::from(local))
}

fn attr_name(name: &str) -> QualName {
    QualName::new(None, Namespace::from(""), LocalName::from(name))
}

fn id(n: NodeId) -> f64 {
    n.as_u64() as f64
}

fn nid(x: f64) -> NodeId {
    NodeId::from_u64(x as u64)
}

pub(crate) fn install(ctx: &Ctx<'_>, shared: Rc<RefCell<Shared>>, base: Option<&Url>) {
    let n = Object::new(ctx.clone()).unwrap();
    let doc = shared.borrow().doc.clone();
    macro_rules! op {
        ($name:literal, $f:expr) => {
            n.set(
                $name,
                Function::new(ctx.clone(), $f)
                    .unwrap()
                    .with_name($name)
                    .unwrap(),
            )
            .unwrap();
        };
    }
    type D = Rc<RefCell<BaseDocument>>;
    let d = |doc: &D| doc.clone();

    let dd = d(&doc);
    op!("root", move || id(dd.borrow().root_node().id));
    let dd = d(&doc);
    op!("createElement", move |ns: String, local: String| id(dd
        .borrow_mut()
        .mutate()
        .create_element(qual(&ns, &local), Vec::new())));
    let dd = d(&doc);
    op!("createText", move |s: String| id(dd
        .borrow_mut()
        .mutate()
        .create_text_node(&s)));
    let dd = d(&doc);
    op!("createComment", move |s: String| id(dd
        .borrow_mut()
        .mutate()
        .create_comment_node(&s)));
    let dd = d(&doc);
    op!("kind", move |n: f64| -> u32 {
        match dd.borrow().get_node(nid(n)).map(|n| &n.data) {
            Some(NodeData::Document(_)) => 9,
            Some(NodeData::Element(_)) | Some(NodeData::AnonymousBlock(_)) => 1,
            Some(NodeData::Text(_)) => 3,
            Some(NodeData::Comment { .. }) => 8,
            None => 0,
        }
    });
    let dd = d(&doc);
    op!("local", move |n: f64| -> String {
        dd.borrow()
            .get_node(nid(n))
            .and_then(|n| n.element_data())
            .map(|e| e.name.local.to_string())
            .unwrap_or_default()
    });
    let dd = d(&doc);
    // Whether a <link>/<style> node's stylesheet has been loaded and added (for link `load`).
    op!("hasSheet", move |n: f64| -> bool {
        dd.borrow().node_has_stylesheet(nid(n))
    });
    let dd = d(&doc);
    op!("ns", move |n: f64| -> String {
        dd.borrow()
            .get_node(nid(n))
            .and_then(|n| n.element_data())
            .map(|e| e.name.ns.to_string())
            .unwrap_or_default()
    });
    let dd = d(&doc);
    op!("parent", move |n: f64| -> Option<f64> {
        dd.borrow().get_node(nid(n)).and_then(|n| n.parent).map(id)
    });
    let dd = d(&doc);
    op!("children", move |n: f64| -> Vec<f64> {
        dd.borrow()
            .get_node(nid(n))
            .map(|n| n.children.iter().map(|&c| id(c)).collect())
            .unwrap_or_default()
    });
    let dd = d(&doc);
    op!("first", move |n: f64| -> Option<f64> {
        dd.borrow()
            .get_node(nid(n))
            .and_then(|n| n.children.first().copied())
            .map(id)
    });
    let dd = d(&doc);
    op!("last", move |n: f64| -> Option<f64> {
        dd.borrow()
            .get_node(nid(n))
            .and_then(|n| n.children.last().copied())
            .map(id)
    });
    let dd = d(&doc);
    op!("sibling", move |n: f64, step: i32| -> Option<f64> {
        let doc = dd.borrow();
        let parent = doc.get_node(nid(n))?.parent?;
        let kids = &doc.get_node(parent)?.children;
        let i = kids.iter().position(|&c| c == nid(n))? as i64 + i64::from(step);
        (i >= 0)
            .then(|| kids.get(i as usize).copied())
            .flatten()
            .map(id)
    });
    let dd = d(&doc);
    op!("insert", move |parent: f64,
                        child: f64,
                        before: Option<f64>| {
        let mut doc = dd.borrow_mut();
        let has_parent = doc.get_node(nid(child)).is_some_and(|c| c.parent.is_some());
        let mut m = doc.mutate();
        if has_parent {
            m.remove_node(nid(child));
        }
        match before {
            Some(b) => m.insert_nodes_before(nid(b), &[nid(child)]),
            None => m.append_children(nid(parent), &[nid(child)]),
        }
    });
    let dd = d(&doc);
    op!("remove", move |child: f64| {
        let mut doc = dd.borrow_mut();
        if doc.get_node(nid(child)).is_some_and(|c| c.parent.is_some()) {
            doc.mutate().remove_node(nid(child));
        }
    });
    let dd = d(&doc);
    op!("getAttr", move |n: f64, name: String| -> Option<String> {
        let doc = dd.borrow();
        let el = doc.get_node(nid(n))?.element_data()?;
        el.attrs()
            .iter()
            .find(|a| &*a.name.local == name.as_str())
            .map(|a| a.value.clone())
    });
    let dd = d(&doc);
    op!("setAttr", move |n: f64, name: String, value: String| {
        dd.borrow_mut()
            .mutate()
            .set_attribute(nid(n), attr_name(&name), &value);
    });
    let dd = d(&doc);
    op!("delAttr", move |n: f64, name: String| {
        dd.borrow_mut()
            .mutate()
            .clear_attribute(nid(n), attr_name(&name));
    });
    let dd = d(&doc);
    op!("attrNames", move |n: f64| -> Vec<String> {
        let doc = dd.borrow();
        doc.get_node(nid(n))
            .and_then(|n| n.element_data())
            .map(|e| e.attrs().iter().map(|a| a.name.local.to_string()).collect())
            .unwrap_or_default()
    });
    let dd = d(&doc);
    op!("text", move |n: f64| -> String {
        let doc = dd.borrow();
        match doc.get_node(nid(n)).map(|n| &n.data) {
            Some(NodeData::Comment { contents }) => contents.clone(),
            Some(_) => doc.get_node(nid(n)).unwrap().text_content(),
            None => String::new(),
        }
    });
    let dd = d(&doc);
    op!("setText", move |n: f64, s: String| {
        let mut doc = dd.borrow_mut();
        let is_char_data = matches!(
            doc.get_node(nid(n)).map(|n| &n.data),
            Some(NodeData::Text(_)) | Some(NodeData::Comment { .. })
        );
        let mut m = doc.mutate();
        if is_char_data {
            m.set_node_text(nid(n), &s);
        } else {
            m.remove_and_drop_all_children(nid(n));
            if !s.is_empty() {
                let t = m.create_text_node(&s);
                m.append_children(nid(n), &[t]);
            }
        }
    });
    let dd = d(&doc);
    op!("setStyle", move |n: f64, prop: String, value: String| {
        dd.borrow_mut()
            .mutate()
            .set_style_property(nid(n), &prop, &value);
    });
    let dd = d(&doc);
    op!("delStyle", move |n: f64, prop: String| {
        dd.borrow_mut()
            .mutate()
            .remove_style_property(nid(n), &prop);
    });
    let dd = d(&doc);
    op!("query", move |scope: f64, sel: String| -> Option<f64> {
        dd.borrow()
            .query_selector_in(nid(scope), &sel)
            .ok()
            .flatten()
            .map(id)
    });
    let dd = d(&doc);
    op!("queryAll", move |scope: f64, sel: String| -> Vec<f64> {
        dd.borrow()
            .query_selector_all_in(nid(scope), &sel)
            .map(|v| v.iter().map(|&n| id(n)).collect())
            .unwrap_or_default()
    });
    let dd = d(&doc);
    op!("setInnerHtml", move |n: f64, html: String| {
        dd.borrow_mut().mutate().set_inner_html(nid(n), &html);
    });
    let dd = d(&doc);
    op!("rect", move |n: f64| -> Vec<f64> {
        let mut doc = dd.borrow_mut();
        doc.resolve(crate::animation_time());
        doc.get_client_bounding_rect(nid(n))
            .map(|r| vec![r.x, r.y, r.width, r.height])
            .unwrap_or(vec![0.0; 4])
    });
    let dd = d(&doc);
    // An iframe's laid-out content, for pagination by height: null until its sub-document for
    // `url` (absolute; an older document may still be attached while the new one loads) is
    // attached with its stylesheets loaded, then [contentHeight, top0, bottom0, top1, bottom1, ...]:
    // every line box and image box in CSS px, in the sub-document's coordinates, in tree order.
    op!("subdocLines", move |n: f64,
                             url: String|
          -> Option<Vec<f64>> {
        let mut doc = dd.borrow_mut();
        doc.resolve(crate::animation_time());
        let sub = doc.get_node(nid(n))?.element_data()?.sub_doc_data()?;
        let sd = sub.inner();
        if sd.url().as_str() != url || sd.has_pending_critical_resources() {
            return None;
        }
        let scale = f64::from(sd.viewport().scale());
        let root = sd.root_element();
        let mut out = vec![f64::from(root.scroll_height())];
        let mut stack = vec![root.id];
        while let Some(id) = stack.pop() {
            let Some(node) = sd.get_node(id) else {
                continue;
            };
            if let Some(el) = node.element_data() {
                let layout = node.final_layout();
                let origin = node.absolute_position(0.0, 0.0);
                if let Some(text) = el
                    .inline_layout_data
                    .as_ref()
                    .filter(|_| node.flags.is_inline_root())
                {
                    let top = f64::from(
                        origin.y + layout.border.top + layout.padding.top + text.block_offset,
                    );
                    for line in text.layout.lines() {
                        let m = line.metrics();
                        out.push(top + f64::from(m.block_min_coord) / scale);
                        out.push(top + f64::from(m.block_max_coord) / scale);
                    }
                } else if el.image_data().is_some() {
                    out.push(f64::from(origin.y));
                    out.push(f64::from(origin.y + layout.size.height));
                }
            }
            stack.extend(node.children.iter().rev().copied());
        }
        let bottom = out[1..].iter().copied().fold(0.0, f64::max);
        out[0] = out[0].max(bottom);
        Some(out)
    });
    let dd = d(&doc);
    // Scrolls an iframe's sub-document to `y` CSS px (a page of a paginated section): paint only.
    op!("subdocScroll", move |n: f64, y: f64| -> bool {
        let mut doc = dd.borrow_mut();
        let Some(sub) = doc.get_node_mut(nid(n)).and_then(|node| node.subdoc_mut()) else {
            return false;
        };
        let mut sd = sub.inner_mut();
        sd.set_viewport_scroll(blitz_dom::Point { x: 0.0, y });
        sd.shell_provider.request_redraw();
        true
    });
    let dd = d(&doc);
    // Computed value of one longhand or custom property ("" for shorthands and unstyled nodes).
    op!("computed", move |n: f64, prop: String| -> String {
        let mut doc = dd.borrow_mut();
        doc.resolve(crate::animation_time());
        let Ok(id) = style::properties::PropertyId::parse_enabled_for_all_content(&prop) else {
            return String::new();
        };
        let Err(decl) = id.as_shorthand() else {
            return String::new();
        };
        doc.get_node(nid(n))
            .and_then(|node| node.primary_styles())
            .map(|s| s.computed_value_to_string(decl))
            .unwrap_or_default()
    });
    let dd = d(&doc);
    op!("viewport", move || -> Vec<f64> {
        let doc = dd.borrow();
        let v = doc.viewport();
        let s = f64::from(v.hidpi_scale);
        vec![
            f64::from(v.window_size.0) / s,
            f64::from(v.window_size.1) / s,
            s,
        ]
    });
    let sh = shared.clone();
    op!("now", move || sh.borrow().start.elapsed().as_secs_f64()
        * 1000.0);
    let sh = shared.clone();
    op!("log", move |level: String, s: String| {
        log::debug!(target: "js_console", "{level}: {s}");
        sh.borrow_mut().messages.push(format!("{level}: {s}"));
    });
    let sh = shared.clone();
    op!("error", move |s: String| sh.borrow_mut().errors.push(s));
    // A script inserted after parsing: read through the embedder's loader and run; false if unreadable.
    let sh = shared.clone();
    n.set(
        "loadScript",
        Function::new(ctx.clone(), move |ctx: Ctx<'_>, src: String| -> bool {
            let url = {
                let s = sh.borrow();
                s.base
                    .as_ref()
                    .and_then(|b| b.join(&src).ok())
                    .or_else(|| Url::parse(&src).ok())
            };
            let Some(url) = url else { return false };
            if url.scheme() != "file" {
                return match crate::run_loader_script(&ctx, &sh, &url) {
                    Ok(()) => true,
                    Err(e) => {
                        sh.borrow_mut().errors.push(format!("{url}: {e}"));
                        e != "cannot load"
                    }
                };
            }
            let Some(bytes) = url.to_file_path().ok().and_then(|p| std::fs::read(p).ok()) else {
                sh.borrow_mut().errors.push(format!("cannot load {url}"));
                return false;
            };
            if let Err(e) = crate::eval_named(&ctx, &String::from_utf8_lossy(&bytes), url.as_str())
            {
                sh.borrow_mut().errors.push(format!("{url}: {e}"));
            }
            true
        })
        .unwrap()
        .with_name("loadScript")
        .unwrap(),
    )
    .unwrap();
    n.set("href", base.map(Url::to_string).unwrap_or_default())
        .unwrap();
    ctx.globals().set("__n", n).unwrap();
}
