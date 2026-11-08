//! Small DOM pieces readest-app and foliate-js's paginator call on the reader page.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

#[test]
fn replace_children_and_links() {
    let html = "<!DOCTYPE html><html><body><div id='d'><i>a</i>b</div><div id='h'></div>\
        <a href='#x'>1</a><a name='y'>2</a><iframe srcdoc='<a href=\"z\">3</a>'></iframe></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const d = document.getElementById('d');
        const s = document.createElement('span');
        d.replaceChildren(s, 'text');
        console.log(d.childNodes.length, d.firstChild === s, d.lastChild.data);
        d.replaceChildren();
        console.log(d.childNodes.length);
        const root = document.getElementById('h').attachShadow({ mode: 'open' });
        root.append(document.createElement('b'));
        root.replaceChildren(document.createElement('u'), document.createElement('u'));
        console.log(root.childNodes.length, root.firstChild.localName);
        const f = document.querySelector('iframe').contentDocument;
        console.log(document.links.length, document.links[0].getAttribute('href'), f.links.length);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(logs, ["log: 2 true text", "log: 0", "log: 2 u", "log: 1 #x 1"]);
}
