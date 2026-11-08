// `Intl` for tauri-runtime-blitz (QuickJS has none): what readest-app's bundle calls, without
// locale data. Plural rules for the main language families; word, grapheme and sentence
// segmentation by Unicode properties (Han is one word per character, as there is no dictionary);
// collation by code point after the sensitivity's folding; English number, list, date and
// relative-time formats; DisplayNames knows no names (callers fall back to the code).
(() => {
  if (globalThis.Intl) return;

  const TAG = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;
  function canonical(tag) {
    const s = String(tag);
    if (!TAG.test(s)) throw new RangeError(`Incorrect locale information provided: ${s}`);
    return s
      .split('-')
      .map((p, i) =>
        i === 0
          ? p.toLowerCase()
          : p.length === 4 && /^[a-z]+$/i.test(p)
            ? p[0].toUpperCase() + p.slice(1).toLowerCase()
            : p.length === 2 || /^\d{3}$/.test(p)
              ? p.toUpperCase()
              : p.toLowerCase(),
      )
      .join('-');
  }
  const getCanonicalLocales = (locales) =>
    locales == null
      ? []
      : [...new Set((typeof locales === 'string' ? [locales] : [...locales]).map(canonical))];
  // The first requested locale, canonical, or 'en'.
  const pick = (locales) => {
    try {
      return getCanonicalLocales(locales)[0] ?? 'en';
    } catch {
      return 'en';
    }
  };
  const lang = (locale) => locale.split('-')[0];

  // ---- PluralRules ----
  const intOf = (n) => (Number.isInteger(n) ? n : null);
  const slavic = (many) => (n) => {
    const i = intOf(n);
    if (i === null) return 'other';
    const m10 = i % 10,
      m100 = i % 100;
    if (many === 'pl' ? i === 1 : m10 === 1 && m100 !== 11) return 'one';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
    return 'many';
  };
  const CARDINAL = [
    ['zh ja ko vi th id ms my km lo bo yue jv su', ['other'], () => 'other'],
    [
      'fr pt hi bn fa am kn zu',
      ['one', 'many', 'other'],
      (n) => (n >= 0 && n < 2 ? 'one' : 'other'),
    ],
    ['ru uk be', ['one', 'few', 'many', 'other'], slavic('ru')],
    ['pl', ['one', 'few', 'many', 'other'], slavic('pl')],
    [
      'cs sk',
      ['one', 'few', 'many', 'other'],
      (n) =>
        n === 1
          ? 'one'
          : intOf(n) !== null && n >= 2 && n <= 4
            ? 'few'
            : intOf(n) === null
              ? 'many'
              : 'other',
    ],
    [
      'ar',
      ['zero', 'one', 'two', 'few', 'many', 'other'],
      (n) => {
        if (n === 0) return 'zero';
        if (n === 1) return 'one';
        if (n === 2) return 'two';
        const m = n % 100;
        return intOf(n) === null ? 'other' : m >= 3 && m <= 10 ? 'few' : m >= 11 ? 'many' : 'other';
      },
    ],
    ['he iw', ['one', 'two', 'other'], (n) => (n === 1 ? 'one' : n === 2 ? 'two' : 'other')],
  ].flatMap(([langs, cats, fn]) => langs.split(' ').map((l) => [l, [cats, fn]]));
  const cardinal = new Map(CARDINAL);
  const ONE_OTHER = [['one', 'other'], (n) => (n === 1 ? 'one' : 'other')];
  const EN_ORDINAL = [
    ['one', 'two', 'few', 'other'],
    (n) => {
      const m10 = n % 10,
        m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return 'one';
      if (m10 === 2 && m100 !== 12) return 'two';
      if (m10 === 3 && m100 !== 13) return 'few';
      return 'other';
    },
  ];
  class PluralRules {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._type = options.type ?? 'cardinal';
      const l = lang(this._locale);
      [this._cats, this._fn] =
        this._type === 'ordinal'
          ? l === 'en'
            ? EN_ORDINAL
            : [['other'], () => 'other']
          : (cardinal.get(l) ?? ONE_OTHER);
    }
    select(n) {
      return this._fn(Math.abs(Number(n)));
    }
    resolvedOptions() {
      return { locale: this._locale, type: this._type, pluralCategories: this._cats.slice() };
    }
    static supportedLocalesOf(l) {
      return getCanonicalLocales(l);
    }
  }

  // ---- Segmenter ----
  const WORD =
    /\p{Script=Han}|[\p{Script=Hiragana}\p{Script=Katakana}ー]+|[\p{L}\p{N}\p{M}_]+(?:['’.:·][\p{L}\p{N}\p{M}_]+)*|\s+|./gsu;
  const WORDLIKE = /^[\p{L}\p{N}_]/u;
  const GRAPHEME = /\r\n|\p{RI}\p{RI}|.(?:\p{M}|\p{Emoji_Modifier}|\u{fe0f}|‍.)*/gsu;
  const SENTENCE_END = /[.!?。！？…]+["'”’)\]」』]*\s*/gu;
  function split(input, granularity) {
    const out = [];
    if (granularity === 'sentence') {
      let start = 0;
      SENTENCE_END.lastIndex = 0;
      for (let m; (m = SENTENCE_END.exec(input)); ) {
        const end = m.index + m[0].length;
        out.push({ segment: input.slice(start, end), index: start, input });
        start = end;
      }
      if (start < input.length) out.push({ segment: input.slice(start), index: start, input });
      return out;
    }
    const re = granularity === 'word' ? WORD : GRAPHEME;
    re.lastIndex = 0;
    for (let m; (m = re.exec(input)); ) {
      const s = { segment: m[0], index: m.index, input };
      if (granularity === 'word') s.isWordLike = WORDLIKE.test(m[0]);
      out.push(s);
    }
    return out;
  }
  class Segments {
    constructor(input, granularity) {
      this._input = input;
      this._g = granularity;
    }
    get _all() {
      this._list ??= split(this._input, this._g);
      return this._list;
    }
    [Symbol.iterator]() {
      return this._all[Symbol.iterator]();
    }
    containing(i = 0) {
      const n = Number(i);
      return this._all.find((s) => n >= s.index && n < s.index + s.segment.length);
    }
  }
  class Segmenter {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._g = options.granularity ?? 'grapheme';
    }
    segment(input) {
      return new Segments(String(input), this._g);
    }
    resolvedOptions() {
      return { locale: this._locale, granularity: this._g };
    }
    static supportedLocalesOf(l) {
      return getCanonicalLocales(l);
    }
  }

  // ---- Collator ----
  const MARKS = /\p{M}+/gu;
  const stripMarks = (s) => s.normalize('NFD').replace(MARKS, '');
  const swapCase = (s) => {
    let out = '';
    for (const c of s) {
      const u = c.toUpperCase();
      out += u === c ? c.toLowerCase() : u;
    }
    return out;
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const NUM = /(\d+)/;
  function cmpNumeric(a, b) {
    const x = a.split(NUM),
      y = b.split(NUM);
    for (let i = 0; i < x.length && i < y.length; i++) {
      const c = i % 2 ? Number(x[i]) - Number(y[i]) || cmp(x[i], y[i]) : cmp(x[i], y[i]);
      if (c) return Math.sign(c);
    }
    return Math.sign(x.length - y.length);
  }
  class Collator {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._numeric = !!options.numeric;
      this._sens = options.sensitivity ?? 'variant';
      this.compare = this.compare.bind(this);
    }
    compare(a, b) {
      const c = this._numeric ? cmpNumeric : cmp;
      const x = String(a),
        y = String(b);
      const primary = c(stripMarks(x).toLowerCase(), stripMarks(y).toLowerCase());
      if (primary || this._sens === 'base') return primary;
      if (this._sens !== 'case') {
        const accent = c(x.normalize('NFD').toLowerCase(), y.normalize('NFD').toLowerCase());
        if (accent || this._sens === 'accent') return accent;
      }
      // Lowercase sorts before uppercase.
      return c(swapCase(x), swapCase(y));
    }
    resolvedOptions() {
      return { locale: this._locale, numeric: this._numeric, sensitivity: this._sens };
    }
    static supportedLocalesOf(l) {
      return getCanonicalLocales(l);
    }
  }

  // ---- NumberFormat ----
  const CURRENCY = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: 'CN¥', INR: '₹', KRW: '₩' };
  const UNIT = { byte: 'byte', kilobyte: 'kB', megabyte: 'MB', gigabyte: 'GB', terabyte: 'TB' };
  const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  class NumberFormat {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._o = options;
    }
    format(value) {
      const o = this._o,
        style = o.style ?? 'decimal';
      let n = Number(value);
      if (!Number.isFinite(n)) return String(n);
      if (style === 'percent') n *= 100;
      const min = o.minimumFractionDigits ?? (style === 'currency' ? 2 : 0);
      const max = Math.max(
        min,
        o.maximumFractionDigits ?? (style === 'currency' ? 2 : style === 'percent' ? 0 : 3),
      );
      let [int, frac = ''] = Math.abs(n).toFixed(max).split('.');
      frac = frac.replace(/0+$/, '').padEnd(min, '0');
      if (o.useGrouping !== false) int = group(int);
      const num = (n < 0 ? '-' : '') + int + (frac ? `.${frac}` : '');
      if (style === 'percent') return `${num}%`;
      if (style === 'currency') {
        const code = String(o.currency).toUpperCase();
        const sym = CURRENCY[code];
        return sym ? (n < 0 ? `-${sym}${num.slice(1)}` : sym + num) : `${code} ${num}`;
      }
      if (style === 'unit') return `${num} ${UNIT[o.unit] ?? o.unit}`;
      return num;
    }
    resolvedOptions() {
      return { locale: this._locale, ...this._o };
    }
    static supportedLocalesOf(l) {
      return getCanonicalLocales(l);
    }
  }

  // ---- DateTimeFormat ----
  const MONTHS =
    'January February March April May June July August September October November December'.split(
      ' ',
    );
  const DAYS = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
  const timeZone = () => {
    const off = new Date().getTimezoneOffset();
    return off === 0 || off % 60 ? 'UTC' : `Etc/GMT${off > 0 ? '+' : '-'}${Math.abs(off / 60)}`;
  };
  class DateTimeFormat {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._o = options;
    }
    format(date = Date.now()) {
      const d = new Date(date),
        o = this._o;
      const dateStyle = o.dateStyle,
        timeStyle = o.timeStyle;
      const has = (k) => o[k] !== undefined;
      const anyDate = has('year') || has('month') || has('day') || has('weekday');
      const anyTime = has('hour') || has('minute') || has('second');
      const parts = [];
      if (dateStyle || anyDate || !(timeStyle || anyTime)) {
        const month =
          dateStyle === 'long' || dateStyle === 'full'
            ? 'long'
            : dateStyle === 'medium'
              ? 'short'
              : o.month;
        const y = d.getFullYear(),
          m = d.getMonth(),
          day = d.getDate();
        let s;
        if (month === 'long' || month === 'short') {
          const name = month === 'long' ? MONTHS[m] : MONTHS[m].slice(0, 3);
          s = [name, has('day') || dateStyle ? `${day}` : ''].filter(Boolean).join(' ');
          if (has('year') || dateStyle) s += s.includes(' ') ? `, ${y}` : ` ${y}`;
        } else if (anyDate && !has('day') && !has('month')) s = has('year') ? `${y}` : '';
        else s = `${m + 1}/${day}/${dateStyle === 'short' ? String(y).slice(2) : y}`;
        if (has('weekday') || dateStyle === 'full') {
          const w = o.weekday === 'short' ? DAYS[d.getDay()].slice(0, 3) : DAYS[d.getDay()];
          s = s ? `${w}, ${s}` : w;
        }
        if (s) parts.push(s);
      }
      if (timeStyle || anyTime) {
        const h = d.getHours(),
          min = String(d.getMinutes()).padStart(2, '0');
        const h12 = o.hour12 ?? o.hourCycle !== 'h23';
        let t = h12 ? `${h % 12 || 12}:${min}` : `${String(h).padStart(2, '0')}:${min}`;
        if (has('second') || timeStyle === 'medium' || timeStyle === 'long')
          t += `:${String(d.getSeconds()).padStart(2, '0')}`;
        parts.push(h12 ? `${t} ${h < 12 ? 'AM' : 'PM'}` : t);
      }
      return parts.join(', ');
    }
    formatToParts(date) {
      return [{ type: 'literal', value: this.format(date) }];
    }
    resolvedOptions() {
      return {
        locale: this._locale,
        calendar: 'gregory',
        numberingSystem: 'latn',
        timeZone: timeZone(),
        ...this._o,
      };
    }
    static supportedLocalesOf(l) {
      return getCanonicalLocales(l);
    }
  }

  // ---- ListFormat, RelativeTimeFormat, DisplayNames, Locale ----
  class ListFormat {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._type = options.type ?? 'conjunction';
      this._style = options.style ?? 'long';
    }
    format(list) {
      const a = [...list].map(String);
      if (this._type === 'unit') return a.join(this._style === 'narrow' ? ' ' : ', ');
      if (lang(this._locale) !== 'en') return a.join(/^(zh|ja)/.test(this._locale) ? '、' : ', ');
      const word = this._type === 'disjunction' ? 'or' : 'and';
      if (a.length < 3) return a.join(` ${word} `);
      return `${a.slice(0, -1).join(', ')}, ${word} ${a[a.length - 1]}`;
    }
  }
  class RelativeTimeFormat {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._o = options;
    }
    format(value, unit) {
      const v = Number(value),
        u = String(unit).replace(/s$/, '');
      const n = Math.abs(v);
      const s = `${n} ${u}${n === 1 ? '' : 's'}`;
      return v < 0 || Object.is(v, -0) ? `${s} ago` : `in ${s}`;
    }
  }
  class DisplayNames {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._o = options;
    }
    of() {
      return undefined;
    }
  }
  const RTL = new Set('ar he iw fa ur yi ps dv ug ckb sd syr'.split(' '));
  class Locale {
    constructor(tag) {
      const t = canonical(tag);
      const p = t.split('-');
      this.language = p[0];
      this.script = p.find((x, i) => i > 0 && x.length === 4 && /^[A-Z][a-z]{3}$/.test(x));
      this.region = p.find((x, i) => i > 0 && /^([A-Z]{2}|\d{3})$/.test(x));
      this.baseName = [this.language, this.script, this.region].filter(Boolean).join('-');
      this._tag = t;
    }
    get textInfo() {
      return { direction: RTL.has(this.language) && this.script !== 'Latn' ? 'rtl' : 'ltr' };
    }
    getTextInfo() {
      return this.textInfo;
    }
    maximize() {
      return this;
    }
    minimize() {
      return this;
    }
    toString() {
      return this._tag;
    }
  }

  // The pre-ES2015 constructors also work when called without `new`.
  const callable = (C) => {
    function F(...args) {
      return new C(...args);
    }
    F.prototype = C.prototype;
    F.supportedLocalesOf = C.supportedLocalesOf;
    return F;
  };
  globalThis.Intl = {
    getCanonicalLocales,
    PluralRules,
    Segmenter,
    Collator: callable(Collator),
    NumberFormat: callable(NumberFormat),
    DateTimeFormat: callable(DateTimeFormat),
    ListFormat,
    RelativeTimeFormat,
    DisplayNames,
    Locale,
  };
})();
