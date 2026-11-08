//! Custom elements in bootstrap.js: foliate-js's reader is <foliate-view> and <foliate-paginator>.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

/// Runs `script` in a page with `body`; returns its console.log lines and JS errors.
fn run(body: &str, script: &str) -> (Vec<String>, Vec<String>) {
    let html = format!("<!DOCTYPE html><html><body>{body}</body></html>");
    let mut doc = QjsDocument::from_html(&html, DocumentConfig::default());
    doc.eval(script, "test");
    doc.run_jobs();
    let logs = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned));
    (logs.collect(), doc.take_js_errors())
}

const LOG_CLASS: &str = r#"
const log = [];
class XLog extends HTMLElement {
  static observedAttributes = ['a'];
  #n = log.push('construct ' + this.getAttribute('a'));
  attributeChangedCallback(k, old, v) { log.push(`attr ${k} ${old} ${v}`); }
  connectedCallback() { log.push('connected'); }
  disconnectedCallback() { log.push('disconnected'); }
  get private() { return this.#n > 0; }
}
"#;

#[test]
fn create_element_constructs_a_defined_element() {
    let (logs, errors) = run(
        "",
        &format!(
            "{LOG_CLASS}
            customElements.define('x-log', XLog);
            const el = document.createElement('x-log');
            console.log(el instanceof XLog, el.private, el.localName, customElements.get('x-log') === XLog);
            el.setAttribute('a', '1');
            el.setAttribute('b', '2');
            el.removeAttribute('a');
            document.body.appendChild(el);
            el.remove();
            console.log(log.join('|'));
            const direct = new XLog();
            console.log(direct.localName, direct.parentNode, customElements.getName(XLog));"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "true true x-log true",
            "construct null|attr a null 1|attr a 1 null|connected|disconnected",
            "x-log null x-log",
        ]
    );
}

#[test]
fn define_upgrades_parsed_elements_in_place() {
    let (logs, errors) = run(
        "<div><x-log a='p'><span></span></x-log></div>",
        &format!(
            "{LOG_CLASS}
            const before = document.querySelector('x-log');
            let resolved = false;
            customElements.whenDefined('x-log').then((c) => {{ resolved = c === XLog; }});
            console.log(before instanceof XLog);
            customElements.define('x-log', XLog);
            console.log(before instanceof XLog, before === document.querySelector('x-log'), before.firstChild.localName);
            console.log(log.join('|'));
            Promise.resolve().then(() => console.log('whenDefined', resolved));"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "false",
            "true true span",
            "construct p|attr a null p|connected",
            "whenDefined true",
        ]
    );
}

#[test]
fn elements_upgrade_when_inserted_and_through_inner_html() {
    let (logs, errors) = run(
        "",
        &format!(
            "{LOG_CLASS}
            const early = document.createElement('x-log');
            customElements.define('x-log', XLog);
            console.log(early instanceof XLog);
            const host = document.createElement('div');
            host.appendChild(early);
            document.body.appendChild(host);
            console.log(early instanceof XLog);
            document.body.innerHTML = '<p><x-log a=\"h\"></x-log></p>';
            console.log(document.querySelector('x-log') instanceof XLog);
            console.log(log.join('|'));"
        ),
    );
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "false",
            "true",
            "true",
            "construct null|connected|disconnected|construct h|attr a null h|connected",
        ]
    );
}

#[test]
fn define_rejects_invalid_and_repeated_names() {
    let (logs, _) = run(
        "",
        "class A extends HTMLElement {}
        const tryDefine = (n, c) => { try { customElements.define(n, c); return 'ok'; } catch (e) { return e.name; } };
        console.log(tryDefine('nohyphen', A), tryDefine('a-b', A), tryDefine('a-b', class extends HTMLElement {}), tryDefine('c-d', A));
        try { new HTMLElement(); } catch (e) { console.log(e.name); }",
    );
    assert_eq!(
        logs,
        [
            "SyntaxError ok NotSupportedError NotSupportedError",
            "TypeError"
        ]
    );
}
