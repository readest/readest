//! The native side: `__n.*` functions over `blitz-dom` nodes, called by `bootstrap.js`.
//!
//! Nodes cross as number handles. The page's are its raw node ids; an iframe's document gets a
//! tag when JS first asks for it (`subdoc`), and its nodes get negative handles from a table
//! (node ids use all 64 bits, so they cannot share a number with a tag). Absent nodes are `null`;
//! a handle into a document that was replaced (its iframe navigated) reaches nothing.

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use blitz_dom::{BaseDocument, LocalName, Namespace, NodeId, QualName, node::NodeData};
use rquickjs::{Ctx, Function, Object, function::Opt};
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

/// Handles of iframe-document nodes: negative, from -2 (-1 is a DocumentFragment's), freed when
/// the frame's document goes away.
#[derive(Default)]
struct Handles {
    of: HashMap<(u32, NodeId), f64>,
    at: HashMap<u64, (u32, NodeId)>,
    next: u64,
}

/// An iframe's document: the iframe (in the document tagged `parent`) and the sub-document's id.
struct Frame {
    parent: u32,
    iframe: NodeId,
    doc: usize,
    live: bool,
}

/// The page and the iframe documents JS has reached (tag = index + 1).
#[derive(Clone)]
struct Docs {
    main: Rc<RefCell<BaseDocument>>,
    frames: Rc<RefCell<Vec<Frame>>>,
    handles: Rc<RefCell<Handles>>,
}

impl Docs {
    fn enc(&self, tag: u32, n: NodeId) -> f64 {
        if tag == 0 {
            return n.as_u64() as f64;
        }
        let mut h = self.handles.borrow_mut();
        if let Some(&v) = h.of.get(&(tag, n)) {
            return v;
        }
        h.next = h.next.max(1) + 1;
        let k = h.next;
        h.of.insert((tag, n), -(k as f64));
        h.at.insert(k, (tag, n));
        -(k as f64)
    }

    /// A handle no document knows decodes to a tag with no frame.
    fn dec(&self, h: f64) -> (u32, NodeId) {
        if h >= 0.0 {
            return (0, NodeId::from_u64(h as u64));
        }
        let at = &self.handles.borrow().at;
        at.get(&(-h as u64))
            .copied()
            .unwrap_or((u32::MAX, NodeId::default()))
    }

    /// Runs `f` on the document of handle `h`, with the node and the document's tag.
    fn with<R>(&self, h: f64, f: impl FnOnce(&mut BaseDocument, NodeId, u32) -> R) -> Option<R> {
        let (tag, node) = self.dec(h);
        let path = self.path(tag)?;
        descend(&mut self.main.borrow_mut(), &path, |doc| f(doc, node, tag))
    }

    /// The (iframe, document id) steps from the page down to the document tagged `tag`.
    fn path(&self, mut tag: u32) -> Option<Vec<(NodeId, usize)>> {
        let frames = self.frames.borrow();
        let mut path = Vec::new();
        while tag != 0 {
            let f = frames.get(tag as usize - 1).filter(|f| f.live)?;
            path.push((f.iframe, f.doc));
            tag = f.parent;
        }
        path.reverse();
        Some(path)
    }

    fn tag_for(&self, parent: u32, iframe: NodeId, doc: usize) -> u32 {
        let found = self
            .frames
            .borrow()
            .iter()
            .position(|f| f.live && f.parent == parent && f.iframe == iframe && f.doc == doc);
        if let Some(i) = found {
            return i as u32 + 1;
        }
        self.prune();
        let mut frames = self.frames.borrow_mut();
        frames.push(Frame {
            parent,
            iframe,
            doc,
            live: true,
        });
        frames.len() as u32
    }

    /// Forgets the frames whose document is gone (iframe removed or navigated, or a frame above
    /// gone; a frame comes after the one it is in) and their handles.
    fn prune(&self) {
        let mut dead = Vec::new();
        let count = self.frames.borrow().len();
        for i in 0..count {
            let tag = i as u32 + 1;
            if !self.frames.borrow()[i].live {
                continue;
            }
            let gone = self
                .path(tag)
                .is_none_or(|p| descend(&mut self.main.borrow_mut(), &p, |_| ()).is_none());
            if gone {
                self.frames.borrow_mut()[i].live = false;
                dead.push(tag);
            }
        }
        if !dead.is_empty() {
            let mut h = self.handles.borrow_mut();
            h.of.retain(|(t, _), _| !dead.contains(t));
            h.at.retain(|_, (t, _)| !dead.contains(t));
        }
    }

    /// Styles and lays out the page and, through it, every iframe document.
    fn resolve(&self) {
        self.main.borrow_mut().resolve(crate::animation_time());
    }
}

fn descend<R>(
    doc: &mut BaseDocument,
    path: &[(NodeId, usize)],
    f: impl FnOnce(&mut BaseDocument) -> R,
) -> Option<R> {
    let Some((&(iframe, id), rest)) = path.split_first() else {
        return Some(f(doc));
    };
    let sub = doc.get_node_mut(iframe)?.subdoc_mut()?;
    let mut inner = sub.inner_mut();
    if inner.id() != id {
        return None;
    }
    descend(&mut inner, rest, f)
}

/// The element bootstrap.js lays a shadow tree out in (`attachShadow`).
const SHADOW_ROOT: &str = "blitz-shadow-root";

/// Whether `node`, a descendant of `scope`, is in `scope`'s tree: no shadow root between them.
fn in_tree_of(doc: &BaseDocument, scope: NodeId, node: NodeId) -> bool {
    let mut p = doc.get_node(node).and_then(|n| n.parent);
    while let Some(pid) = p.filter(|&p| p != scope) {
        let Some(parent) = doc.get_node(pid) else {
            return true;
        };
        if parent
            .element_data()
            .is_some_and(|e| &*e.name.local == SHADOW_ROOT)
        {
            return false;
        }
        p = parent.parent;
    }
    true
}

/// Line and image boxes of a laid-out document for pagination by height: [contentHeight, top0,
/// bottom0, top1, bottom1, ...] in CSS px, in tree order.
fn lines(sd: &BaseDocument) -> Vec<f64> {
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
    out
}

pub(crate) fn install(ctx: &Ctx<'_>, shared: Rc<RefCell<Shared>>, base: Option<&Url>) {
    let n = Object::new(ctx.clone()).unwrap();
    let docs = Docs {
        main: shared.borrow().doc.clone(),
        frames: Rc::default(),
        handles: Rc::default(),
    };
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

    // The root (document node) of `h`'s document; the page's without `h`.
    let d = docs.clone();
    op!("root", move |h: Opt<f64>| d
        .with(h.0.unwrap_or(0.0), |doc, _, tag| d
            .enc(tag, doc.root_node().id)));
    // Nodes are created in the document of `doc` (any handle in it).
    let d = docs.clone();
    op!(
        "createElement",
        move |doc: f64, ns: String, local: String| d.with(doc, |doc, _, tag| d.enc(
            tag,
            doc.mutate().create_element(qual(&ns, &local), Vec::new())
        ))
    );
    let d = docs.clone();
    op!("createText", move |doc: f64, s: String| d
        .with(doc, |doc, _, tag| d
            .enc(tag, doc.mutate().create_text_node(&s))));
    let d = docs.clone();
    op!("createComment", move |doc: f64, s: String| d
        .with(doc, |doc, _, tag| d
            .enc(tag, doc.mutate().create_comment_node(&s))));
    let d = docs.clone();
    op!("kind", move |h: f64| -> u32 {
        d.with(h, |doc, n, _| match doc.get_node(n).map(|n| &n.data) {
            Some(NodeData::Document(_)) => 9,
            Some(NodeData::Element(_)) | Some(NodeData::AnonymousBlock(_)) => 1,
            Some(NodeData::Text(_)) => 3,
            Some(NodeData::Comment { .. }) => 8,
            None => 0,
        })
        .unwrap_or(0)
    });
    let d = docs.clone();
    op!("local", move |h: f64| -> String {
        d.with(h, |doc, n, _| {
            doc.get_node(n)
                .and_then(|n| n.element_data())
                .map(|e| e.name.local.to_string())
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    // Whether a <link>/<style> node's stylesheet has been loaded and added (for link `load`).
    op!("hasSheet", move |h: f64| -> bool {
        d.with(h, |doc, n, _| doc.node_has_stylesheet(n))
            .unwrap_or(false)
    });
    let d = docs.clone();
    op!("ns", move |h: f64| -> String {
        d.with(h, |doc, n, _| {
            doc.get_node(n)
                .and_then(|n| n.element_data())
                .map(|e| e.name.ns.to_string())
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    op!("parent", move |h: f64| -> Option<f64> {
        d.with(h, |doc, n, tag| {
            doc.get_node(n)?.parent.map(|p| d.enc(tag, p))
        })
        .flatten()
    });
    let d = docs.clone();
    op!("children", move |h: f64| -> Vec<f64> {
        d.with(h, |doc, n, tag| {
            doc.get_node(n)
                .map(|n| n.children.iter().map(|&c| d.enc(tag, c)).collect())
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    op!("first", move |h: f64| -> Option<f64> {
        d.with(h, |doc, n, tag| {
            doc.get_node(n)?.children.first().map(|&c| d.enc(tag, c))
        })
        .flatten()
    });
    let d = docs.clone();
    op!("last", move |h: f64| -> Option<f64> {
        d.with(h, |doc, n, tag| {
            doc.get_node(n)?.children.last().map(|&c| d.enc(tag, c))
        })
        .flatten()
    });
    let d = docs.clone();
    op!("sibling", move |h: f64, step: i32| -> Option<f64> {
        d.with(h, |doc, n, tag| {
            let parent = doc.get_node(n)?.parent?;
            let kids = &doc.get_node(parent)?.children;
            let i = kids.iter().position(|&c| c == n)? as i64 + i64::from(step);
            let c = *kids.get(usize::try_from(i).ok()?)?;
            Some(d.enc(tag, c))
        })
        .flatten()
    });
    let d = docs.clone();
    // False when `child` is in another document than `parent` (nodes are not adopted).
    op!("insert", move |parent: f64,
                        child: f64,
                        before: Option<f64>|
          -> bool {
        if d.dec(parent).0 != d.dec(child).0 {
            return false;
        }
        d.with(parent, |doc, parent, _| {
            let child = d.dec(child).1;
            let has_parent = doc.get_node(child).is_some_and(|c| c.parent.is_some());
            let mut m = doc.mutate();
            if has_parent {
                m.remove_node(child);
            }
            match before {
                Some(b) => m.insert_nodes_before(d.dec(b).1, &[child]),
                None => m.append_children(parent, &[child]),
            }
        })
        .is_some()
    });
    let d = docs.clone();
    op!("remove", move |h: f64| {
        d.with(h, |doc, n, _| {
            if doc.get_node(n).is_some_and(|c| c.parent.is_some()) {
                doc.mutate().remove_node(n);
            }
        });
    });
    let d = docs.clone();
    op!("getAttr", move |h: f64, name: String| -> Option<String> {
        d.with(h, |doc, n, _| {
            let el = doc.get_node(n)?.element_data()?;
            el.attrs()
                .iter()
                .find(|a| &*a.name.local == name.as_str())
                .map(|a| a.value.clone())
        })
        .flatten()
    });
    let d = docs.clone();
    op!("setAttr", move |h: f64, name: String, value: String| {
        d.with(h, |doc, n, _| {
            doc.mutate().set_attribute(n, attr_name(&name), &value)
        });
    });
    let d = docs.clone();
    op!("delAttr", move |h: f64, name: String| {
        d.with(h, |doc, n, _| {
            doc.mutate().clear_attribute(n, attr_name(&name))
        });
    });
    let d = docs.clone();
    op!("attrNames", move |h: f64| -> Vec<String> {
        d.with(h, |doc, n, _| {
            doc.get_node(n)
                .and_then(|n| n.element_data())
                .map(|e| e.attrs().iter().map(|a| a.name.local.to_string()).collect())
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    op!("text", move |h: f64| -> String {
        d.with(h, |doc, n, _| match doc.get_node(n).map(|n| &n.data) {
            Some(NodeData::Comment { contents }) => contents.clone(),
            Some(_) => doc.get_node(n).unwrap().text_content(),
            None => String::new(),
        })
        .unwrap_or_default()
    });
    let d = docs.clone();
    op!("setText", move |h: f64, s: String| {
        d.with(h, |doc, n, _| {
            let is_char_data = matches!(
                doc.get_node(n).map(|n| &n.data),
                Some(NodeData::Text(_)) | Some(NodeData::Comment { .. })
            );
            let mut m = doc.mutate();
            if is_char_data {
                m.set_node_text(n, &s);
            } else {
                m.remove_and_drop_all_children(n);
                if !s.is_empty() {
                    let t = m.create_text_node(&s);
                    m.append_children(n, &[t]);
                }
            }
        });
    });
    let d = docs.clone();
    op!("setStyle", move |h: f64, prop: String, value: String| {
        d.with(h, |doc, n, _| {
            doc.mutate().set_style_property(n, &prop, &value)
        });
    });
    let d = docs.clone();
    op!("delStyle", move |h: f64, prop: String| {
        d.with(h, |doc, n, _| doc.mutate().remove_style_property(n, &prop));
    });
    let d = docs.clone();
    // Queries stay in `scope`'s tree: shadow trees are laid out in place (bootstrap.js), so the
    // matches under a shadow root below `scope` are dropped. `queryAllDeep` keeps them.
    op!("query", move |scope: f64, sel: String| -> Option<f64> {
        d.with(scope, |doc, scope, tag| {
            let first = doc.query_selector_in(scope, &sel).ok().flatten()?;
            if in_tree_of(doc, scope, first) {
                return Some(d.enc(tag, first));
            }
            let all = doc.query_selector_all_in(scope, &sel).ok()?;
            all.into_iter()
                .find(|&n| in_tree_of(doc, scope, n))
                .map(|n| d.enc(tag, n))
        })
        .flatten()
    });
    let d = docs.clone();
    op!("queryAll", move |scope: f64, sel: String| -> Vec<f64> {
        d.with(scope, |doc, scope, tag| {
            doc.query_selector_all_in(scope, &sel).ok().map(|v| {
                v.into_iter()
                    .filter(|&n| in_tree_of(doc, scope, n))
                    .map(|n| d.enc(tag, n))
                    .collect()
            })
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    op!("queryAllDeep", move |scope: f64, sel: String| -> Vec<f64> {
        d.with(scope, |doc, scope, tag| {
            doc.query_selector_all_in(scope, &sel)
                .ok()
                .map(|v| v.iter().map(|&n| d.enc(tag, n)).collect())
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    op!("setInnerHtml", move |h: f64, html: String| {
        d.with(h, |doc, n, _| doc.mutate().set_inner_html(n, &html));
    });
    let d = docs.clone();
    // In the coordinates of the node's document (an iframe's viewport for its content).
    op!("rect", move |h: f64| -> Vec<f64> {
        d.resolve();
        d.with(h, |doc, n, _| {
            doc.get_client_bounding_rect(n)
                .map(|r| vec![r.x, r.y, r.width, r.height])
        })
        .flatten()
        .unwrap_or(vec![0.0; 4])
    });
    let d = docs.clone();
    // An element's scroll offset: [scrollLeft, scrollTop].
    op!("scroll", move |h: f64| -> Vec<f64> {
        d.with(h, |doc, n, _| {
            doc.get_node(n).map(|node| {
                let o = node.scroll_offset();
                vec![o.x, o.y]
            })
        })
        .flatten()
        .unwrap_or(vec![0.0; 2])
    });
    let d = docs.clone();
    // Scrolls an element to (x, y) CSS px, clamped to what it can scroll; false when it did not move.
    op!("scrollTo", move |h: f64, x: f64, y: f64| -> bool {
        d.resolve();
        d.with(h, |doc, n, _| {
            let before = doc.get_node(n).map(|node| *node.scroll_offset());
            doc.scroll_to(n, x, y, blitz_dom::ScrollBehavior::Instant);
            before != doc.get_node(n).map(|node| *node.scroll_offset())
        })
        .unwrap_or(false)
    });
    let d = docs.clone();
    // CSSOM View sizes: [clientWidth, clientHeight, scrollWidth, scrollHeight].
    op!("sizes", move |h: f64| -> Vec<f64> {
        d.resolve();
        d.with(h, |doc, n, _| {
            let node = doc.get_node(n)?;
            Some(
                [
                    node.client_width(),
                    node.client_height(),
                    node.scroll_width(),
                    node.scroll_height(),
                ]
                .map(f64::from)
                .to_vec(),
            )
        })
        .flatten()
        .unwrap_or(vec![0.0; 4])
    });
    let d = docs.clone();
    // An iframe's document: its root's handle, or null while it has none.
    op!("subdoc", move |iframe: f64| -> Option<f64> {
        let d2 = d.clone();
        let (parent, sub) = d
            .with(iframe, |doc, n, tag| {
                let sub = doc.get_node_mut(n)?.subdoc_mut()?;
                let inner = sub.inner();
                Some((tag, (n, inner.id(), inner.root_node().id)))
            })
            .flatten()?;
        let (n, id, root) = sub;
        Some(d2.enc(d2.tag_for(parent, n, id), root))
    });
    let d = docs.clone();
    // The id of an iframe's document once it is attached with its stylesheets loaded (its `load`).
    op!("subdocReady", move |iframe: f64| -> Option<f64> {
        d.with(iframe, |doc, n, _| {
            let sub = doc.get_node(n)?.element_data()?.sub_doc_data()?;
            let sd = sub.inner();
            (!sd.has_pending_critical_resources()).then(|| sd.id() as f64)
        })
        .flatten()
    });
    let d = docs.clone();
    // An iframe's laid-out content for pagination by height: null until its sub-document for
    // `url` (absolute; an older document may still be attached while the new one loads) is
    // attached with its stylesheets loaded, then `lines()`.
    op!("subdocLines", move |iframe: f64,
                             url: String|
          -> Option<Vec<f64>> {
        d.resolve();
        d.with(iframe, |doc, n, _| {
            let sub = doc.get_node(n)?.element_data()?.sub_doc_data()?;
            let sd = sub.inner();
            (sd.url().as_str() == url && !sd.has_pending_critical_resources()).then(|| lines(&sd))
        })
        .flatten()
    });
    let d = docs.clone();
    // Scrolls an iframe's sub-document to `y` CSS px (a page of a paginated section): paint only.
    op!("subdocScroll", move |iframe: f64, y: f64| -> bool {
        d.with(iframe, |doc, n, _| {
            let sub = doc.get_node_mut(n)?.subdoc_mut()?;
            let mut sd = sub.inner_mut();
            sd.set_viewport_scroll(blitz_dom::Point { x: 0.0, y });
            sd.shell_provider.request_redraw();
            Some(())
        })
        .flatten()
        .is_some()
    });
    let d = docs.clone();
    // Computed value of one longhand or custom property ("" for shorthands and unstyled nodes).
    op!("computed", move |h: f64, prop: String| -> String {
        let Ok(id) = style::properties::PropertyId::parse_enabled_for_all_content(&prop) else {
            return String::new();
        };
        let Err(decl) = id.as_shorthand() else {
            return String::new();
        };
        d.resolve();
        d.with(h, |doc, n, _| {
            doc.get_node(n)
                .and_then(|node| node.primary_styles())
                .map(|s| s.computed_value_to_string(decl))
        })
        .flatten()
        .unwrap_or_default()
    });
    let d = docs.clone();
    // [width, height] in CSS px and the scale of `h`'s document's viewport (the page's without `h`).
    op!("viewport", move |h: Opt<f64>| -> Vec<f64> {
        // An iframe document's viewport is its iframe's box, set by layout.
        if h.0.is_some_and(|h| h < 0.0) {
            d.resolve();
        }
        d.with(h.0.unwrap_or(0.0), |doc, _, _| {
            let v = doc.viewport();
            let s = f64::from(v.hidpi_scale);
            vec![
                f64::from(v.window_size.0) / s,
                f64::from(v.window_size.1) / s,
                s,
            ]
        })
        .unwrap_or(vec![0.0, 0.0, 1.0])
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
