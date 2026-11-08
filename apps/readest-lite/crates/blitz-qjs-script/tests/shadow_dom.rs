//! Shadow roots in bootstrap.js: foliate-js's view and paginator build their UI in one.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

/// Runs `script` in a page with `body`; returns its console.log lines and JS errors.
fn run(body: &str, script: &str) -> (Vec<String>, Vec<String>) {
    let html = format!(
        "<!DOCTYPE html><html><head><style>body {{ margin: 0 }} .host {{ display: block; width: 200px }}</style></head><body>{body}</body></html>"
    );
    let mut doc = QjsDocument::from_html(&html, DocumentConfig::default());
    doc.eval(script, "test");
    doc.run_jobs();
    let logs = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned));
    (logs.collect(), doc.take_js_errors())
}

const SHADOW: &str = r#"
const host = document.querySelector('.host');
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
  :host { height: 30px }
  #in { width: 40px; height: 10px }
  :host([wide]) #in { width: 80px }
</style><div id="in"></div>`;
const inner = root.getElementById('in');
"#;

#[test]
fn shadow_root_is_its_own_tree() {
    let (logs, errors) = run(
        "<div class='host'></div>",
        &format!(
            "{SHADOW}
            console.log(root instanceof ShadowRoot, root instanceof DocumentFragment, root.nodeType, root.host === host, host.shadowRoot === root, root.mode);
            console.log(!!inner, inner.parentNode === root, inner.getRootNode() === root, inner.isConnected, root.parentNode);
            console.log(document.getElementById('in'), document.querySelectorAll('div').length, host.querySelector('div'), host.childNodes.length, host.firstChild);
            console.log(root.childNodes.length, root.children.length, root.querySelectorAll('div').length, root.firstElementChild.localName);
            try {{ host.attachShadow({{ mode: 'open' }}); }} catch (e) {{ console.log(e.name); }}"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "true true 11 true true open",
            "true true true true null",
            "null 1 null 0 null",
            "2 2 1 style",
            "NotSupportedError",
        ]
    );
}

#[test]
fn shadow_content_renders_with_scoped_styles() {
    let (logs, errors) = run(
        "<div class='host'></div><div class='host' id='other'></div>",
        &format!(
            "{SHADOW}
            const other = document.getElementById('other').attachShadow({{ mode: 'open' }});
            other.innerHTML = '<div id=\"in\"></div>';
            const size = (el) => {{ const r = el.getBoundingClientRect(); return `${{r.width}}x${{r.height}}`; }};
            console.log(size(host), size(inner), size(other.getElementById('in')));
            host.setAttribute('wide', '');
            console.log(size(inner));"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["200x30 40x10 200x0", "80x10"]);
}

#[test]
fn events_are_retargeted_at_the_host() {
    let (logs, errors) = run(
        "<div class='host'></div>",
        &format!(
            "{SHADOW}
            const seen = [];
            const note = (where) => (e) => seen.push(`${{where}}:${{e.target === inner ? 'inner' : e.target === host ? 'host' : '?'}}`);
            root.addEventListener('ping', note('root'));
            host.addEventListener('ping', note('host'));
            document.body.addEventListener('ping', note('body'));
            inner.dispatchEvent(new Event('ping', {{ bubbles: true, composed: true }}));
            inner.dispatchEvent(new Event('ping', {{ bubbles: true }}));
            console.log(seen.join(' '));
            const path = [];
            inner.addEventListener('pong', (e) => path.push(...e.composedPath()));
            inner.dispatchEvent(new Event('pong', {{ composed: true }}));
            console.log(path.includes(root), path.includes(host), path[0] === inner);"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "root:inner host:host body:host root:inner",
            "true true true",
        ]
    );
}

#[test]
fn light_children_stay_apart_from_the_shadow_tree() {
    let (logs, errors) = run(
        "<div class='host'></div>",
        &format!(
            "{SHADOW}
            const span = document.createElement('span');
            host.appendChild(span);
            console.log(host.childNodes.length, host.firstChild === span, host.lastChild === span, span.previousSibling, host.children.length);
            host.prepend('t');
            console.log(host.firstChild.nodeType, host.childNodes.length);
            host.textContent = '';
            console.log(host.childNodes.length, root.getElementById('in') === inner, inner.isConnected);
            host.innerHTML = '<b></b>';
            console.log(host.childNodes.length, root.getElementById('in') === inner, inner.isConnected);"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        ["1 true true null 1", "3 2", "0 true true", "1 true true"]
    );
}

#[test]
fn custom_elements_in_shadow_trees_upgrade_and_connect() {
    let (logs, errors) = run(
        "<div class='host'></div>",
        &format!(
            "{SHADOW}
            const log = [];
            const early = document.createElement('x-in');
            root.appendChild(early);
            customElements.define('x-in', class extends HTMLElement {{
              connectedCallback() {{ log.push('connected ' + (this.getRootNode() === root)); }}
            }});
            console.log(early.constructor !== HTMLElement, log.join('|'));"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["true connected true"]);
}
