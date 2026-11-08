//! intl.js in QuickJS (which has no Intl): the parts readest-app's bundle calls.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

fn run(script: &str) -> Vec<String> {
    let mut doc = QjsDocument::from_html("<html><body></body></html>", DocumentConfig::default());
    doc.eval(include_str!("../src/intl.js"), "intl.js");
    doc.eval(script, "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn plural_rules_as_i18next_uses_them() {
    let logs = run("
        const sel = (l, ns, o) => { const r = new Intl.PluralRules(l, o); return ns.map((n) => r.select(n)).join(' ') + ' | ' + r.resolvedOptions().pluralCategories.join(' '); };
        console.log(sel('en', [0, 1, 2, 1.5]));
        console.log(sel('zh-CN', [0, 1, 2]));
        console.log(sel('fr', [0, 1, 2]));
        console.log(sel('ru', [1, 2, 5, 11, 21, 22, 1.5]));
        console.log(sel('pl', [1, 2, 5, 22, 25]));
        console.log(sel('ar', [0, 1, 2, 3, 11, 100]));
        console.log(sel('en', [1, 2, 3, 4, 11, 12, 21], { type: 'ordinal' }));
    ");
    assert_eq!(
        logs,
        [
            "other one other other | one other",
            "other other other | other",
            "one one other | one many other",
            "one few many many one few other | one few many other",
            "one few many few many | one few many other",
            "zero one two few many other | zero one two few many other",
            "one two few other other other one | one two few other",
        ]
    );
}

#[test]
fn segmenter_words_graphemes_sentences() {
    let logs = run(r#"
        const seg = (g, s, l) => [...new Intl.Segmenter(l, { granularity: g }).segment(s)];
        console.log(seg('word', "Don't stop, 3.14 now!").map((s) => `${s.segment}${s.isWordLike ? '*' : ''}@${s.index}`).join('|'));
        console.log(seg('word', '我爱读书。カタカナ').map((s) => s.segment + (s.isWordLike ? '*' : '')).join('|'));
        console.log(seg('grapheme', 'éa👍🏽🇫🇷\r\n').length);
        console.log(seg('sentence', 'One. Two? "Three!" Four').map((s) => JSON.stringify(s.segment)).join(' '));
        const c = new Intl.Segmenter('en', { granularity: 'word' }).segment('hello world').containing(7);
        console.log(c.segment, c.index, c.isWordLike, new Intl.Segmenter().segment('ab').containing(5));
    "#);
    assert_eq!(
        logs,
        [
            "Don't*@0| @5|stop*@6|,@10| @11|3.14*@12| @16|now*@17|!@20",
            "我*|爱*|读*|书*|。|カタカナ*",
            "5",
            "\"One. \" \"Two? \" \"\\\"Three!\\\" \" \"Four\"",
            "world 6 true undefined",
        ]
    );
}

#[test]
fn collator_number_list_locale() {
    let logs = run("
        const base = new Intl.Collator('en', { sensitivity: 'base' });
        console.log(base.compare('Résumé', 'resume'), base.compare('a', 'b'), base.compare('b', 'a'));
        console.log(new Intl.Collator('en', { sensitivity: 'accent' }).compare('Résumé', 'resume') !== 0);
        console.log(['b10.jpg', 'B2.jpg', 'a1.jpg'].sort(new Intl.Collator([], { numeric: true }).compare).join(' '));
        console.log(['b', 'B', 'a', 'C'].sort(new Intl.Collator().compare).join(''));
        const nf = (l, o, v) => new Intl.NumberFormat(l, o).format(v);
        console.log(nf('en', { style: 'unit', unit: 'megabyte', unitDisplay: 'short', maximumFractionDigits: 2 }, 1.2345), nf('en', { style: 'unit', unit: 'byte', unitDisplay: 'short' }, 512));
        console.log(nf('en-US', { style: 'currency', currency: 'USD' }, 1234.5), nf('en', {}, 1234567.891), nf('en', { style: 'percent' }, 0.256), nf('en', { minimumFractionDigits: 2 }, 3));
        console.log(new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(['a', 'b', 'c']), '|', new Intl.ListFormat('en', { style: 'narrow', type: 'unit' }).format(['1h', '5m']), '|', new Intl.ListFormat('en').format(['x', 'y']));
        console.log(Intl.getCanonicalLocales('zh-hant-tw')[0], Intl.getCanonicalLocales(['EN-us', 'fr']).join(','));
        try { Intl.getCanonicalLocales('zh_TW'); } catch (e) { console.log(e.name); }
        const l = new Intl.Locale('ar-EG');
        console.log(l.language, l.region, l.baseName, l.textInfo.direction, new Intl.Locale('zh-Hant').getTextInfo().direction, new Intl.Locale('zh-Hant').script);
        console.log(new Intl.RelativeTimeFormat('en').format(-3, 'day'), '|', new Intl.RelativeTimeFormat('en').format(1, 'hour'));
        console.log(new Intl.DisplayNames(['en'], { type: 'language' }).of('fr'), typeof Intl.DateTimeFormat().resolvedOptions().timeZone);
        console.log(new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(2026, 10, 8)), new Intl.DateTimeFormat('en').format(new Date(2026, 10, 8)));
    ");
    assert_eq!(
        logs,
        [
            "0 -1 1",
            "true",
            "a1.jpg B2.jpg b10.jpg",
            "abBC",
            "1.23 MB 512 byte",
            "$1,234.50 1,234,567.891 26% 3.00",
            "a, b, and c | 1h 5m | x and y",
            "zh-Hant-TW en-US,fr",
            "RangeError",
            "ar EG ar-EG rtl ltr Hant",
            "3 days ago | in 1 hour",
            "undefined string",
            "Nov 8, 2026 11/8/2026",
        ]
    );
}
