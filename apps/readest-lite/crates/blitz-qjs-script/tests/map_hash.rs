//! QuickJS's Map and Set pick a key's bucket by the low bits of its hash. For a number key the
//! hash was the bits of the double times a constant, which leaves the low bits zero for small
//! integers: the DOM shim's wrapper tables, keyed by node id, kept most of a page's nodes in a few
//! buckets, and each lookup walked one of them (~2.5 µs a lookup with 5,000 nodes on a PC).

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

#[test]
fn small_integer_keys_find_their_entry_as_fast_as_string_keys() {
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        DocumentConfig::default(),
    );
    // the best of 3 rounds of looking up each of 20,000 keys, for keys 0..20000 and the same keys
    // as strings (which hash well)
    doc.eval(
        "const time = (keys) => {
            const m = new Map();
            for (const k of keys) m.set(k, 1);
            let best = Infinity;
            for (let r = 0; r < 3; r++) {
                const t = performance.now();
                let s = 0;
                for (const k of keys) s += m.get(k);
                best = Math.min(best, performance.now() - t);
            }
            return best;
        };
        const ints = [...Array(20000).keys()];
        const ratio = time(ints) / time(ints.map(String));
        console.log(ratio < 3 ? 'fast' : `slow: ${ratio.toFixed(1)}x the strings' time`);",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: fast"]);
}
