// `Intl` for tauri-runtime-blitz (QuickJS has none): what readest-app's bundle calls, without
// locale data. Plural rules for the main language families; word, grapheme and sentence
// segmentation by Unicode properties (Han is one word per character, as there is no dictionary);
// collation by code point after the sensitivity's folding; English number, list, date and
// relative-time formats, also behind Date's and Number's toLocale*String; DisplayNames gives
// English names of languages, regions and scripts, and a language's own name in its own locale.
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
      if (Number.isNaN(d.getTime())) throw new RangeError('Invalid time value');
      const dateStyle = o.dateStyle,
        timeStyle = o.timeStyle;
      const has = (k) => o[k] !== undefined;
      const anyDate = has('year') || has('month') || has('day') || has('weekday');
      const anyTime = has('hour') || has('minute') || has('second');
      // The local time zone, or UTC (no other zone is known).
      const utc = /^(Etc\/)?(UTC|GMT)$/i.test(o.timeZone ?? '');
      const get = (k) => (utc ? d[`getUTC${k}`]() : d[`get${k}`]());
      const num = (v, style) =>
        style === '2-digit' ? String(v).padStart(2, '0').slice(-2) : `${v}`;
      const parts = [];
      if (dateStyle || anyDate || !(timeStyle || anyTime)) {
        const month =
          dateStyle === 'long' || dateStyle === 'full'
            ? 'long'
            : dateStyle === 'medium'
              ? 'short'
              : o.month;
        const y = get('FullYear'),
          m = get('Month'),
          day = get('Date');
        let s;
        if (month === 'long' || month === 'short' || month === 'narrow') {
          const name =
            month === 'long' ? MONTHS[m] : month === 'short' ? MONTHS[m].slice(0, 3) : MONTHS[m][0];
          s = [name, has('day') || dateStyle ? num(day, o.day) : ''].filter(Boolean).join(' ');
          if (has('year') || dateStyle) s += s.includes(' ') ? `, ${y}` : ` ${y}`;
        } else {
          // Numeric: the fields asked for, or all three.
          const all = dateStyle === 'short' || !anyDate;
          const year = dateStyle === 'short' || o.year === '2-digit' ? String(y).slice(-2) : `${y}`;
          s = [
            (all || has('month')) && num(m + 1, o.month),
            (all || has('day')) && num(day, o.day),
            (all || has('year')) && year,
          ]
            .filter(Boolean)
            .join('/');
        }
        if (has('weekday') || dateStyle === 'full') {
          const name = DAYS[get('Day')];
          const w =
            o.weekday === 'short' ? name.slice(0, 3) : o.weekday === 'narrow' ? name[0] : name;
          s = s ? `${w}, ${s}` : w;
        }
        if (s) parts.push(s);
      }
      if (timeStyle || anyTime) {
        const h = get('Hours'),
          min = String(get('Minutes')).padStart(2, '0');
        const h12 = o.hour12 ?? o.hourCycle !== 'h23';
        let t = h12
          ? `${num(h % 12 || 12, o.hour)}:${min}`
          : `${String(h).padStart(2, '0')}:${min}`;
        if (has('second') || timeStyle === 'medium' || timeStyle === 'long')
          t += `:${String(get('Seconds')).padStart(2, '0')}`;
        parts.push(h12 ? `${t} ${h < 12 ? 'AM' : 'PM'}` : t);
      }
      return parts.join(', ');
    }
    formatToParts(date) {
      return [{ type: 'literal', value: this.format(date) }];
    }
    // As ICU writes English ranges: a named month's shared year (and month) once
    // ("Nov 22 – 28, 2026"), thin spaces around the dash.
    formatRange(start, end) {
      const a = new Date(start),
        b = new Date(end),
        o = this._o;
      const from = this.format(a),
        to = this.format(b);
      if (from === to) return from;
      const dash = ' – ';
      const named = ['long', 'short', 'narrow'].includes(o.month);
      const plain = o.day !== undefined && o.weekday === undefined && o.hour === undefined;
      if (!named || !plain || a.getFullYear() !== b.getFullYear()) return from + dash + to;
      const year = o.year === undefined ? '' : `, ${a.getFullYear()}`;
      const noYear = new DateTimeFormat(this._locale, { ...o, year: undefined });
      const day = o.day === '2-digit' ? String(b.getDate()).padStart(2, '0') : `${b.getDate()}`;
      return (
        noYear.format(a) + dash + (a.getMonth() === b.getMonth() ? day : noYear.format(b)) + year
      );
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
  // intl-names: written by scripts/intl-names.mjs (CLDR, from Node v24.14.0's ICU)
  const LANGUAGE_NAMES =
    "aa:Afar|aar:Afar|ab:Abkhazian|abk:Abkhazian|ace:Acehnese|ach:Acoli|ada:Adangme|adp:Dzongkha|ady:Adyghe|ae:Avestan|aeb:Tunisian Arabic|af:Afrikaans|afh:Afrihili|afr:Afrikaans|agq:Aghem|ain:Ainu|ajt:Tunisian Arabic|aju:Judeo-Arabic|ak:Akan|aka:Akan|akk:Akkadian|akz:Alabama|alb:Albanian|ale:Aleut|aln:Gheg Albanian|als:Albanian|alt:Southern Altai|am:Amharic|amh:Amharic|an:Aragonese|ang:Old English|ann:Obolo|anp:Angika|ar:Arabic|ara:Arabic|arb:Arabic|arc:Aramaic|arg:Aragonese|arm:Armenian|arn:Mapuche|aro:Araona|arp:Arapaho|arq:Algerian Arabic|ars:Najdi Arabic|arw:Arawak|ary:Moroccan Arabic|arz:Egyptian Arabic|as:Assamese|asa:Asu|ase:American Sign Language|asm:Assamese|ast:Asturian|atj:Atikamekw|av:Avaric|ava:Avaric|ave:Avestan|avk:Kotava|awa:Awadhi|ay:Aymara|aym:Aymara|ayr:Aymara|az:Azerbaijani|aze:Azerbaijani|azj:Azerbaijani|ba:Bashkir|bak:Bashkir|bal:Baluchi|bam:Bambara|ban:Balinese|baq:Basque|bar:Bavarian|bas:Basaa|bax:Bamun|bbc:Batak Toba|bbj:Ghomala|bcc:Baluchi|bcl:Bikol|be:Belarusian|bej:Beja|bel:Belarusian|bem:Bemba|ben:Bangla|bew:Betawi|bez:Bena|bfd:Bafut|bfq:Badaga|bg:Bulgarian|bgc:Haryanvi|bgn:Western Balochi|bh:Bhojpuri|bho:Bhojpuri|bi:Bislama|bih:Bhojpuri|bik:Bikol|bin:Bini|bis:Bislama|bjn:Banjar|bkm:Kom|bla:Siksiká|blg:Iban|blo:Anii|blt:Tai Dam|bm:Bambara|bn:Bangla|bo:Tibetan|bod:Tibetan|bos:Bosnian|bpy:Bishnupriya|bqi:Bakhtiari|br:Breton|bra:Braj|bre:Breton|brh:Brahui|brx:Bodo|bs:Bosnian|bss:Akoose|bua:Buriat|bug:Buginese|bul:Bulgarian|bum:Bulu|bur:Burmese|bxk:Luyia|bxr:Buriat|byn:Blin|byv:Medumba|ca:Catalan|cad:Caddo|car:Carib|cat:Catalan|cay:Cayuga|cch:Atsam|ccp:Chakma|ce:Chechen|ceb:Cebuano|ces:Czech|cgg:Chiga|ch:Chamorro|cha:Chamorro|chb:Chibcha|che:Chechen|chg:Chagatai|chi:Chinese|chk:Chuukese|chm:Mari|chn:Chinook Jargon|cho:Choctaw|chp:Chipewyan|chr:Cherokee|chu:Church Slavic|chv:Chuvash|chy:Cheyenne|cic:Chickasaw|ckb:Central Kurdish|clc:Chilcotin|cld:Syriac|cls:Sanskrit|cmn:Chinese|cnr:Serbian (Montenegro)|co:Corsican|cop:Coptic|cor:Cornish|cos:Corsican|cps:Capiznon|cr:Cree|cre:Cree|crg:Michif|crh:Crimean Tatar|crj:Southern East Cree|crk:Plains Cree|crl:Northern East Cree|crm:Moose Cree|crr:Carolina Algonquian|crs:Seselwa Creole French|cs:Czech|csb:Kashubian|csw:Swampy Cree|cu:Church Slavic|cv:Chuvash|cwd:Cree|cy:Welsh|cym:Welsh|cze:Czech|da:Danish|dak:Dakota|dan:Danish|dar:Dargwa|dav:Taita|de:German|del:Delaware|den:Slave|deu:German|dgo:Dogri|dgr:Dogrib|dhd:Marwari|dik:Dinka|din:Dinka|diq:Zaza|div:Divehi|dje:Zarma|doi:Dogri|drh:Mongolian|drw:Persian (Afghanistan)|dsb:Lower Sorbian|dtp:Central Dusun|dua:Duala|dum:Middle Dutch|dut:Dutch|dv:Divehi|dyo:Jola-Fonyi|dyu:Dyula|dz:Dzongkha|dzg:Dazaga|dzo:Dzongkha|ebu:Embu|ee:Ewe|efi:Efik|egl:Emilian|egy:Ancient Egyptian|eka:Ekajuk|ekk:Estonian|el:Greek|ell:Greek|elx:Elamite|emk:Mandingo|en:English|eng:English|enm:Middle English|eo:Esperanto|epo:Esperanto|es:Spanish|esk:Inupiaq|est:Estonian|esu:Central Yupik|et:Estonian|eu:Basque|eus:Basque|ewe:Ewe|ewo:Ewondo|ext:Extremaduran|fa:Persian|fan:Fang|fao:Faroese|fas:Persian|fat:Akan|ff:Fula|fi:Finnish|fij:Fijian|fil:Filipino|fin:Finnish|fit:Tornedalen Finnish|fj:Fijian|fo:Faroese|fon:Fon|fr:French|fra:French|frc:Cajun French|fre:French|frm:Middle French|fro:Old French|frp:Arpitan|frr:Northern Frisian|frs:Eastern Frisian|fry:Western Frisian|fuc:Fula|ful:Fula|fur:Friulian|fy:Western Frisian|ga:Irish|gaa:Ga|gag:Gagauz|gan:Gan Chinese|gay:Gayo|gaz:Oromo|gba:Gbaya|gbo:Grebo|gbz:Zoroastrian Dari|gd:Scottish Gaelic|geo:Georgian|ger:German|gez:Geez|gil:Gilbertese|gl:Galician|gla:Scottish Gaelic|gle:Irish|glg:Galician|glk:Gilaki|glv:Manx|gmh:Middle High German|gn:Guarani|gno:Gondi|goh:Old High German|gom:Konkani|gon:Gondi|gor:Gorontalo|got:Gothic|grb:Grebo|grc:Ancient Greek|gre:Greek|grn:Guarani|gsw:Swiss German|gu:Gujarati|guc:Wayuu|gug:Guarani|guj:Gujarati|gur:Frafra|guz:Gusii|gv:Manx|gwi:Gwichʼin|gya:Gbaya|ha:Hausa|hai:Haida|hak:Hakka Chinese|hat:Haitian Creole|hau:Hausa|haw:Hawaiian|hax:Southern Haida|hbs:Serbian (Latin)|hdn:Haida|he:Hebrew|hea:Hmong|heb:Hebrew|her:Herero|hi:Hindi|hif:Fiji Hindi|hil:Hiligaynon|hin:Hindi|hit:Hittite|hmn:Hmong|hmo:Hiri Motu|hnj:Hmong Njua|ho:Hiri Motu|hr:Croatian|hrv:Croatian|hsb:Upper Sorbian|hsn:Xiang Chinese|ht:Haitian Creole|hu:Hungarian|hun:Hungarian|hup:Hupa|hur:Halkomelem|hy:Armenian|hye:Armenian|hz:Herero|ia:Interlingua|iba:Iban|ibb:Ibibio|ibo:Igbo|ice:Icelandic|id:Indonesian|ido:Ido|ie:Interlingue|ig:Igbo|ii:Sichuan Yi|iii:Sichuan Yi|ik:Inupiaq|ike:Inuktitut|ikt:Western Canadian Inuktitut|iku:Inuktitut|ile:Interlingue|ilo:Iloko|in:Indonesian|ina:Interlingua|ind:Indonesian|inh:Ingush|io:Ido|ipk:Inupiaq|is:Icelandic|isl:Icelandic|it:Italian|ita:Italian|iu:Inuktitut|iw:Hebrew|izh:Ingrian|ja:Japanese|jam:Jamaican Creole English|jav:Javanese|jaw:Javanese|jbo:Lojban|jgo:Ngomba|ji:Yiddish|jmc:Machame|jpn:Japanese|jpr:Judeo-Persian|jrb:Judeo-Arabic|jut:Jutish|jv:Javanese|jw:Javanese|ka:Georgian|kaa:Kara-Kalpak|kab:Kabyle|kac:Kachin|kaj:Jju|kal:Kalaallisut|kam:Kamba|kan:Kannada|kas:Kashmiri|kat:Georgian|kau:Kanuri|kaw:Kawi|kaz:Kazakh|kbd:Kabardian|kbl:Kanembu|kcg:Tyap|kde:Makonde|kea:Kabuverdianu|kek:Qʼeqchiʼ|ken:Kenyang|kfo:Koro|kg:Kongo|kgp:Kaingang|kha:Khasi|khk:Mongolian|khm:Khmer|kho:Khotanese|khq:Koyra Chiini|khw:Khowar|ki:Kikuyu|kik:Kikuyu|kin:Kinyarwanda|kir:Kyrgyz|kiu:Kirmanjki|kj:Kuanyama|kk:Kazakh|kkj:Kako|kl:Kalaallisut|kln:Kalenjin|km:Khmer|kmb:Kimbundu|kmr:Kurdish|kn:Kannada|knc:Kanuri|kng:Kongo|ko:Korean|koi:Komi-Permyak|kok:Konkani|kom:Komi|kon:Kongo|kor:Korean|kos:Kosraean|kpe:Kpelle|kpv:Komi|kr:Kanuri|krc:Karachay-Balkar|kri:Krio|krj:Kinaray-a|krl:Karelian|kru:Kurukh|ks:Kashmiri|ksb:Shambala|ksf:Bafia|ksh:Colognian|ktr:Central Dusun|ku:Kurdish|kua:Kuanyama|kum:Kumyk|kur:Kurdish|kut:Kutenai|kv:Komi|kw:Cornish|kwk:Kwakʼwala|kxl:Kurukh|kxv:Kuvi|ky:Kyrgyz|kzj:Central Dusun|kzt:Central Dusun|la:Latin|lad:Ladino|lag:Langi|lah:Western Panjabi|lam:Lamba|lao:Lao|lat:Latin|lav:Latvian|lb:Luxembourgish|lez:Lezghian|lfn:Lingua Franca Nova|lg:Ganda|li:Limburgish|lij:Ligurian|lil:Lillooet|lim:Limburgish|lin:Lingala|lit:Lithuanian|liv:Livonian|lkt:Lakota|lmo:Lombard|ln:Lingala|lo:Lao|lol:Mongo|lou:Louisiana Creole|loz:Lozi|lrc:Northern Luri|lsm:Saamia|lt:Lithuanian|ltg:Latgalian|ltz:Luxembourgish|lu:Luba-Katanga|lua:Luba-Lulua|lub:Luba-Katanga|lug:Ganda|lui:Luiseno|lun:Lunda|luo:Luo|lus:Mizo|luy:Luyia|lv:Latvian|lvs:Latvian|lzh:Literary Chinese|lzz:Laz|mac:Macedonian|mad:Madurese|maf:Mafa|mag:Magahi|mah:Marshallese|mai:Maithili|mak:Makasar|mal:Malayalam|man:Mandingo|mao:Māori|mar:Marathi|mas:Masai|may:Malay|mde:Maba|mdf:Moksha|mdr:Mandar|men:Mende|mer:Meru|mfe:Morisyen|mg:Malagasy|mga:Middle Irish|mgh:Makhuwa-Meetto|mgo:Metaʼ|mh:Marshallese|mhr:Mari|mi:Māori|mic:Mi'kmaw|min:Minangkabau|mk:Macedonian|mkd:Macedonian|ml:Malayalam|mlg:Malagasy|mlt:Maltese|mn:Mongolian|mnc:Manchu|mni:Manipuri|mo:Romanian|moe:Innu-aimun|moh:Mohawk|mol:Romanian|mon:Mongolian|mos:Mossi|mr:Marathi|mri:Māori|mrj:Western Mari|ms:Malay|msa:Malay|mt:Maltese|mua:Mundang|mul:Multiple languages|mup:Rajasthani|mus:Muscogee|mwl:Mirandese|mwr:Marwari|mwv:Mentawai|my:Burmese|mya:Burmese|mye:Myene|myv:Erzya|mzn:Mazanderani|na:Nauru|nan:Min Nan Chinese|nap:Neapolitan|naq:Nama|nau:Nauru|nav:Navajo|nb:Norwegian Bokmål|nbl:South Ndebele|nd:North Ndebele|nde:North Ndebele|ndo:Ndonga|nds:Low German|ne:Nepali|nep:Nepali|new:Newari|ng:Ndonga|nia:Nias|niu:Niuean|njo:Ao Naga|nl:Dutch|nld:Dutch|nmg:Kwasio|nn:Norwegian Nynorsk|nnh:Ngiemboon|nno:Norwegian Nynorsk|no:Norwegian|nob:Norwegian Bokmål|nog:Nogai|non:Old Norse|nor:Norwegian|nov:Novial|npi:Nepali|nqo:N’Ko|nr:South Ndebele|nso:Northern Sotho|nus:Nuer|nv:Navajo|nwc:Classical Newari|ny:Nyanja|nya:Nyanja|nym:Nyamwezi|nyn:Nyankole|nyo:Nyoro|nzi:Nzima|oc:Occitan|oci:Occitan|oj:Ojibwa|ojb:Northwestern Ojibwa|ojc:Central Ojibwa|ojg:Ojibwa|oji:Ojibwa|ojs:Oji-Cree|ojw:Western Ojibwa|oka:Okanagan|om:Oromo|or:Odia|ori:Odia|orm:Oromo|ory:Odia|os:Ossetic|osa:Osage|oss:Ossetic|ota:Ottoman Turkish|pa:Punjabi|pag:Pangasinan|pal:Pahlavi|pam:Pampanga|pan:Punjabi|pap:Papiamento|pau:Palauan|pbu:Pashto|pcd:Picard|pcm:Nigerian Pidgin|pdc:Pennsylvania German|pdt:Plautdietsch|peo:Old Persian|per:Persian|pes:Persian|pfl:Palatine German|phn:Phoenician|pi:Pali|pis:Pijin|pl:Polish|pli:Pali|plt:Malagasy|pmk:Carolina Algonquian|pms:Piedmontese|pnb:Western Panjabi|pnt:Pontic|pol:Polish|pon:Pohnpeian|por:Portuguese|pqm:Maliseet-Passamaquoddy|prg:Prussian|pro:Old Provençal|prp:Gujarati|prs:Persian (Afghanistan)|ps:Pashto|pt:Portuguese|pus:Pashto|qu:Quechua|quc:Kʼicheʼ|que:Quechua|qug:Chimborazo Highland Quichua|quz:Quechua|raj:Rajasthani|rap:Rapanui|rar:Rarotongan|rgn:Romagnol|rhg:Rohingya|rif:Riffian|rm:Romansh|rmy:Romany|rn:Rundi|ro:Romanian|rof:Rombo|roh:Romansh|rom:Romany|ron:Romanian|rtm:Rotuman|ru:Russian|rue:Rusyn|rug:Roviana|rum:Romanian|run:Rundi|rup:Aromanian|rus:Russian|rw:Kinyarwanda|rwk:Rwa|sa:Sanskrit|sad:Sandawe|sag:Sango|sah:Yakut|sam:Samaritan Aramaic|san:Sanskrit|saq:Samburu|sas:Sasak|sat:Santali|saz:Saurashtra|sba:Ngambay|sbp:Sangu|sc:Sardinian|scc:Serbian|scn:Sicilian|sco:Scots|scr:Croatian|sd:Sindhi|sdc:Sassarese Sardinian|sdh:Southern Kurdish|se:Northern Sami|see:Seneca|seh:Sena|sei:Seri|sel:Selkup|ses:Koyraboro Senni|sg:Sango|sga:Old Irish|sgs:Samogitian|sh:Serbian (Latin)|shi:Tachelhit|shn:Shan|shu:Chadian Arabic|si:Sinhala|sid:Sidamo|sin:Sinhala|sk:Slovak|sl:Slovenian|slh:Southern Lushootseed|sli:Lower Silesian|slk:Slovak|slo:Slovak|slv:Slovenian|sly:Selayar|sm:Samoan|sma:Southern Sami|smd:Kimbundu|sme:Northern Sami|smj:Lule Sami|smn:Inari Sami|smo:Samoan|sms:Skolt Sami|sn:Shona|sna:Shona|snb:Iban|snd:Sindhi|snk:Soninke|so:Somali|sog:Sogdien|som:Somali|sot:Southern Sotho|spa:Spanish|spy:Kalenjin|sq:Albanian|sqi:Albanian|sr:Serbian|src:Sardinian|srd:Sardinian|srn:Sranan Tongo|srp:Serbian|srr:Serer|ss:Swati|ssw:Swati|ssy:Saho|st:Southern Sotho|stq:Saterland Frisian|str:Straits Salish|su:Sundanese|suk:Sukuma|sun:Sundanese|sus:Susu|sux:Sumerian|sv:Swedish|sw:Swahili|swa:Swahili|swb:Comorian|swc:Swahili (Congo - Kinshasa)|swe:Swedish|swh:Swahili|syc:Classical Syriac|syr:Syriac|szl:Silesian|ta:Tamil|tah:Tahitian|tam:Tamil|tat:Tatar|tce:Southern Tutchone|tcy:Tulu|tdu:Central Dusun|te:Telugu|tel:Telugu|tem:Timne|teo:Teso|ter:Tereno|tet:Tetum|tg:Tajik|tgk:Tajik|tgl:Filipino|tgx:Tagish|th:Thai|tha:Thai|tht:Tahltan|ti:Tigrinya|tib:Tibetan|tig:Tigre|tir:Tigrinya|tiv:Tiv|tk:Turkmen|tkl:Tokelauan|tkr:Tsakhur|tl:Filipino|tlh:Klingon|tli:Tlingit|tly:Talysh|tmh:Tamashek|tn:Tswana|tnf:Persian (Afghanistan)|to:Tongan|tog:Nyasa Tonga|tok:Toki Pona|ton:Tongan|tpi:Tok Pisin|tr:Turkish|tru:Turoyo|trv:Taroko|trw:Torwali|ts:Tsonga|tsd:Tsakonian|tsi:Tsimshian|tsn:Tswana|tso:Tsonga|tt:Tatar|ttm:Northern Tutchone|ttq:Tamashek|ttt:Muslim Tat|tuk:Turkmen|tum:Tumbuka|tur:Turkish|tvl:Tuvalu|tw:Akan|twi:Akan|twq:Tasawaq|ty:Tahitian|tyv:Tuvinian|tzm:Central Atlas Tamazight|udm:Udmurt|ug:Uyghur|uga:Ugaritic|uig:Uyghur|uk:Ukrainian|ukr:Ukrainian|umb:Umbundu|umu:Delaware|ur:Urdu|urd:Urdu|uz:Uzbek|uzb:Uzbek|uzn:Uzbek|vai:Vai|ve:Venda|vec:Venetian|ven:Venda|vep:Veps|vi:Vietnamese|vie:Vietnamese|vls:West Flemish|vmf:Main-Franconian|vmw:Makhuwa|vo:Volapük|vol:Volapük|vot:Votic|vro:Võro|vun:Vunjo|wa:Walloon|wae:Walser|wal:Wolaytta|war:Waray|was:Washo|wbp:Warlpiri|wel:Welsh|wln:Walloon|wo:Wolof|wol:Wolof|wuu:Wu Chinese|xal:Kalmyk|xh:Xhosa|xho:Xhosa|xmf:Mingrelian|xnr:Kangri|xog:Soga|xpe:Kpelle|xsl:Slave|yao:Yao|yap:Yapese|yav:Yangben|ybb:Yemba|ydd:Yiddish|yi:Yiddish|yid:Yiddish|yo:Yoruba|yor:Yoruba|yrl:Nheengatu|yue:Cantonese|za:Zhuang|zai:Zapotec|zap:Zapotec|zbl:Blissymbols|zea:Zeelandic|zen:Zenaga|zgh:Standard Moroccan Tamazight|zh:Chinese|zha:Zhuang|zho:Chinese|zsm:Malay|zu:Zulu|zul:Zulu|zun:Zuni|zxx:No linguistic content|zyb:Zhuang|zza:Zaza";
  const REGION_NAMES =
    '142:Asia|143:Central Asia|145:Western Asia|150:Europe|151:Eastern Europe|154:Northern Europe|155:Western Europe|202:Sub-Saharan Africa|419:Latin America|AC:Ascension Island|AD:Andorra|AE:United Arab Emirates|AF:Afghanistan|AG:Antigua & Barbuda|AI:Anguilla|AL:Albania|AM:Armenia|AN:Curaçao|AO:Angola|AQ:Antarctica|AR:Argentina|AS:American Samoa|AT:Austria|AU:Australia|AW:Aruba|AX:Åland Islands|AZ:Azerbaijan|BA:Bosnia & Herzegovina|BB:Barbados|BD:Bangladesh|BE:Belgium|BF:Burkina Faso|BG:Bulgaria|BH:Bahrain|BI:Burundi|BJ:Benin|BL:St. Barthélemy|BM:Bermuda|BN:Brunei|BO:Bolivia|BQ:Caribbean Netherlands|BR:Brazil|BS:Bahamas|BT:Bhutan|BU:Myanmar (Burma)|BV:Bouvet Island|BW:Botswana|BY:Belarus|BZ:Belize|CA:Canada|CC:Cocos (Keeling) Islands|CD:Congo - Kinshasa|CF:Central African Republic|CG:Congo - Brazzaville|CH:Switzerland|CI:Côte d’Ivoire|CK:Cook Islands|CL:Chile|CM:Cameroon|CN:China|CO:Colombia|CP:Clipperton Island|CQ:Sark|CR:Costa Rica|CS:Serbia|CU:Cuba|CV:Cape Verde|CW:Curaçao|CX:Christmas Island|CY:Cyprus|CZ:Czechia|DD:Germany|DE:Germany|DG:Diego Garcia|DJ:Djibouti|DK:Denmark|DM:Dominica|DO:Dominican Republic|DY:Benin|DZ:Algeria|EA:Ceuta & Melilla|EC:Ecuador|EE:Estonia|EG:Egypt|EH:Western Sahara|ER:Eritrea|ES:Spain|ET:Ethiopia|EU:European Union|EZ:Eurozone|FI:Finland|FJ:Fiji|FK:Falkland Islands|FM:Micronesia|FO:Faroe Islands|FR:France|FX:France|GA:Gabon|GB:United Kingdom|GD:Grenada|GE:Georgia|GF:French Guiana|GG:Guernsey|GH:Ghana|GI:Gibraltar|GL:Greenland|GM:Gambia|GN:Guinea|GP:Guadeloupe|GQ:Equatorial Guinea|GR:Greece|GS:South Georgia & South Sandwich Islands|GT:Guatemala|GU:Guam|GW:Guinea-Bissau|GY:Guyana|HK:Hong Kong SAR China|HM:Heard & McDonald Islands|HN:Honduras|HR:Croatia|HT:Haiti|HU:Hungary|HV:Burkina Faso|IC:Canary Islands|ID:Indonesia|IE:Ireland|IL:Israel|IM:Isle of Man|IN:India|IO:British Indian Ocean Territory|IQ:Iraq|IR:Iran|IS:Iceland|IT:Italy|JE:Jersey|JM:Jamaica|JO:Jordan|JP:Japan|KE:Kenya|KG:Kyrgyzstan|KH:Cambodia|KI:Kiribati|KM:Comoros|KN:St. Kitts & Nevis|KP:North Korea|KR:South Korea|KW:Kuwait|KY:Cayman Islands|KZ:Kazakhstan|LA:Laos|LB:Lebanon|LC:St. Lucia|LI:Liechtenstein|LK:Sri Lanka|LR:Liberia|LS:Lesotho|LT:Lithuania|LU:Luxembourg|LV:Latvia|LY:Libya|MA:Morocco|MC:Monaco|MD:Moldova|ME:Montenegro|MF:St. Martin|MG:Madagascar|MH:Marshall Islands|MK:North Macedonia|ML:Mali|MM:Myanmar (Burma)|MN:Mongolia|MO:Macao SAR China|MP:Northern Mariana Islands|MQ:Martinique|MR:Mauritania|MS:Montserrat|MT:Malta|MU:Mauritius|MV:Maldives|MW:Malawi|MX:Mexico|MY:Malaysia|MZ:Mozambique|NA:Namibia|NC:New Caledonia|NE:Niger|NF:Norfolk Island|NG:Nigeria|NH:Vanuatu|NI:Nicaragua|NL:Netherlands|NO:Norway|NP:Nepal|NR:Nauru|NU:Niue|NZ:New Zealand|OM:Oman|PA:Panama|PE:Peru|PF:French Polynesia|PG:Papua New Guinea|PH:Philippines|PK:Pakistan|PL:Poland|PM:St. Pierre & Miquelon|PN:Pitcairn Islands|PR:Puerto Rico|PS:Palestinian Territories|PT:Portugal|PW:Palau|PY:Paraguay|QA:Qatar|QO:Outlying Oceania|RE:Réunion|RH:Zimbabwe|RO:Romania|RS:Serbia|RU:Russia|RW:Rwanda|SA:Saudi Arabia|SB:Solomon Islands|SC:Seychelles|SD:Sudan|SE:Sweden|SG:Singapore|SH:St. Helena|SI:Slovenia|SJ:Svalbard & Jan Mayen|SK:Slovakia|SL:Sierra Leone|SM:San Marino|SN:Senegal|SO:Somalia|SR:Suriname|SS:South Sudan|ST:São Tomé & Príncipe|SU:Russia|SV:El Salvador|SX:Sint Maarten|SY:Syria|SZ:Eswatini|TA:Tristan da Cunha|TC:Turks & Caicos Islands|TD:Chad|TF:French Southern Territories|TG:Togo|TH:Thailand|TJ:Tajikistan|TK:Tokelau|TL:Timor-Leste|TM:Turkmenistan|TN:Tunisia|TO:Tonga|TP:Timor-Leste|TR:Türkiye|TT:Trinidad & Tobago|TV:Tuvalu|TW:Taiwan|TZ:Tanzania|UA:Ukraine|UG:Uganda|UK:United Kingdom|UM:U.S. Outlying Islands|UN:United Nations|US:United States|UY:Uruguay|UZ:Uzbekistan|VA:Vatican City|VC:St. Vincent & Grenadines|VD:Vietnam|VE:Venezuela|VG:British Virgin Islands|VI:U.S. Virgin Islands|VN:Vietnam|VU:Vanuatu|WF:Wallis & Futuna|WS:Samoa|XA:Pseudo-Accents|XB:Pseudo-Bidi|XK:Kosovo|YD:Yemen|YE:Yemen|YT:Mayotte|YU:Serbia|ZA:South Africa|ZM:Zambia|ZR:Congo - Kinshasa|ZW:Zimbabwe|ZZ:Unknown Region|001:world|002:Africa|003:North America|005:South America|009:Oceania|011:Western Africa|013:Central America|014:Eastern Africa|015:Northern Africa|017:Middle Africa|018:Southern Africa|019:Americas|021:Northern America|029:Caribbean|030:Eastern Asia|034:Southern Asia|035:Southeast Asia|039:Southern Europe|053:Australasia|054:Melanesia|057:Micronesian Region|061:Polynesia';
  const SCRIPT_NAMES =
    'Adlm:Adlam|Afak:Afaka|Aghb:Caucasian Albanian|Ahom:Ahom|Arab:Arabic|Aran:Nastaliq|Armi:Imperial Aramaic|Armn:Armenian|Avst:Avestan|Bali:Balinese|Bamu:Bamum|Bass:Bassa Vah|Batk:Batak|Beng:Bangla|Berf:Beria Erfe|Bhks:Bhaiksuki|Blis:Blissymbols|Bopo:Bopomofo|Brah:Brahmi|Brai:Braille|Bugi:Buginese|Buhd:Buhid|Cakm:Chakma|Cans:Unified Canadian Aboriginal Syllabics|Cari:Carian|Cham:Cham|Cher:Cherokee|Chrs:Chorasmian|Cirt:Cirth|Copt:Coptic|Cpmn:Cypro-Minoan|Cprt:Cypriot|Cyrl:Cyrillic|Cyrs:Old Church Slavonic Cyrillic|Deva:Devanagari|Diak:Dives Akuru|Dogr:Dogra|Dsrt:Deseret|Dupl:Duployan shorthand|Egyd:Egyptian demotic|Egyh:Egyptian hieratic|Egyp:Egyptian hieroglyphs|Elba:Elbasan|Elym:Elymaic|Ethi:Ethiopic|Gara:Garay|Geok:Georgian Khutsuri|Geor:Georgian|Glag:Glagolitic|Gong:Gunjala Gondi|Gonm:Masaram Gondi|Goth:Gothic|Gran:Grantha|Grek:Greek|Gujr:Gujarati|Gukh:Gurung Khema|Guru:Gurmukhi|Hanb:Han with Bopomofo|Hang:Hangul|Hani:Han|Hano:Hanunoo|Hans:Simplified|Hant:Traditional|Hatr:Hatran|Hebr:Hebrew|Hira:Hiragana|Hluw:Anatolian Hieroglyphs|Hmng:Pahawh Hmong|Hmnp:Nyiakeng Puachue Hmong|Hrkt:Japanese syllabaries|Hung:Old Hungarian|Inds:Indus|Ital:Old Italic|Jamo:Jamo|Java:Javanese|Jpan:Japanese|Jurc:Jurchen|Kali:Kayah Li|Kana:Katakana|Kawi:Kawi|Khar:Kharoshthi|Khmr:Khmer|Khoj:Khojki|Kits:Khitan small script|Knda:Kannada|Kore:Korean|Kpel:Kpelle|Krai:Kirat Rai|Kthi:Kaithi|Lana:Lanna|Laoo:Lao|Latf:Fraktur Latin|Latg:Gaelic Latin|Latn:Latin|Lepc:Lepcha|Limb:Limbu|Lina:Linear A|Linb:Linear B|Lisu:Fraser|Loma:Loma|Lyci:Lycian|Lydi:Lydian|Mahj:Mahajani|Maka:Makasar|Mand:Mandaean|Mani:Manichaean|Marc:Marchen|Maya:Mayan hieroglyphs|Medf:Medefaidrin|Mend:Mende|Merc:Meroitic Cursive|Mero:Meroitic|Mlym:Malayalam|Modi:Modi|Mong:Mongolian|Moon:Moon|Mroo:Mro|Mtei:Meitei Mayek|Mult:Multani|Mymr:Myanmar|Nagm:Nag Mundari|Nand:Nandinagari|Narb:Old North Arabian|Nbat:Nabataean|Newa:Newa|Nkgb:Naxi Geba|Nkoo:N’Ko|Nshu:Nüshu|Ogam:Ogham|Olck:Ol Chiki|Onao:Ol Onal|Orkh:Orkhon|Orya:Odia|Osge:Osage|Osma:Osmanya|Ougr:Old Uyghur|Palm:Palmyrene|Pauc:Pau Cin Hau|Perm:Old Permic|Phag:Phags-pa|Phli:Inscriptional Pahlavi|Phlp:Psalter Pahlavi|Phlv:Book Pahlavi|Phnx:Phoenician|Plrd:Pollard Phonetic|Prti:Inscriptional Parthian|Qaag:Zawgyi|Rjng:Rejang|Rohg:Hanifi|Roro:Rongorongo|Runr:Runic|Samr:Samaritan|Sara:Sarati|Sarb:Old South Arabian|Saur:Saurashtra|Sgnw:SignWriting|Shaw:Shavian|Shrd:Sharada|Sidd:Siddham|Sidt:Sidetic|Sind:Khudawadi|Sinh:Sinhala|Sogd:Sogdian|Sogo:Old Sogdian|Sora:Sora Sompeng|Soyo:Soyombo|Sund:Sundanese|Sunu:Sunuwar|Sylo:Syloti Nagri|Syrc:Syriac|Syre:Estrangelo Syriac|Syrj:Western Syriac|Syrn:Eastern Syriac|Tagb:Tagbanwa|Takr:Takri|Tale:Tai Le|Talu:New Tai Lue|Taml:Tamil|Tang:Tangut|Tavt:Tai Viet|Tayo:Tai Yo|Telu:Telugu|Teng:Tengwar|Tfng:Tifinagh|Tglg:Tagalog|Thaa:Thaana|Thai:Thai|Tibt:Tibetan|Tirh:Tirhuta|Tnsa:Tangsa|Todr:Todhri|Tols:Tolong Siki|Toto:Toto|Tutg:Tulu-Tigalari|Ugar:Ugaritic|Vaii:Vai|Visp:Visible Speech|Vith:Vithkuqi|Wara:Varang Kshiti|Wcho:Wancho|Wole:Woleai|Xpeo:Old Persian|Xsux:Sumero-Akkadian Cuneiform|Yezi:Yezidi|Yiii:Yi|Zanb:Zanabazar Square|Zinh:Inherited|Zmth:Mathematical Notation|Zsye:Emoji|Zsym:Symbols|Zxxx:Unwritten|Zyyy:Common|Zzzz:Unknown Script';
  const DIALECT_NAMES =
    'ar-001:Modern Standard Arabic|ara-001:Modern Standard Arabic|arb-001:Modern Standard Arabic|chi-Hans:Simplified Chinese|chi-Hant:Traditional Chinese|cmn-Hans:Simplified Chinese|cmn-Hant:Traditional Chinese|cnr-ME:Montenegrin|de-AT:Austrian German|de-CH:Swiss High German|deu-AT:Austrian German|deu-CH:Swiss High German|drw-AF:Dari|dut-BE:Flemish|en-AU:Australian English|en-CA:Canadian English|en-GB:British English|en-UK:British English|en-US:American English|eng-AU:Australian English|eng-CA:Canadian English|eng-GB:British English|eng-UK:British English|eng-US:American English|es-419:Latin American Spanish|es-ES:European Spanish|es-MX:Mexican Spanish|fa-AF:Dari|fas-AF:Dari|fr-CA:Canadian French|fr-CH:Swiss French|fra-CA:Canadian French|fra-CH:Swiss French|fre-CA:Canadian French|fre-CH:Swiss French|ger-AT:Austrian German|ger-CH:Swiss High German|mo-MD:Moldavian|mol-MD:Moldavian|nds-NL:Low Saxon|nl-BE:Flemish|nld-BE:Flemish|per-AF:Dari|pes-AF:Dari|por-BR:Brazilian Portuguese|por-PT:European Portuguese|prs-AF:Dari|pt-BR:Brazilian Portuguese|pt-PT:European Portuguese|ro-MD:Moldavian|ron-MD:Moldavian|rum-MD:Moldavian|scc-ME:Montenegrin|spa-419:Latin American Spanish|spa-ES:European Spanish|spa-MX:Mexican Spanish|sr-ME:Montenegrin|srp-ME:Montenegrin|sw-CD:Congo Swahili|sw-ZR:Congo Swahili|swa-CD:Congo Swahili|swa-ZR:Congo Swahili|swc-CD:Congo Swahili|swc-ZR:Congo Swahili|swh-CD:Congo Swahili|swh-ZR:Congo Swahili|tnf-AF:Dari|zh-Hans:Simplified Chinese|zh-Hant:Traditional Chinese|zho-Hans:Simplified Chinese|zho-Hant:Traditional Chinese';
  const OWN_NAMES =
    'am:አማርኛ|ar:العربية|ars:اللهجة النجدية|as:অসমীয়া|asa:Kipare|ast:asturianu|az:azərbaycan|ba:башҡорт|bas:Ɓàsàa|be:беларуская|bem:Ichibemba|bez:Hibena|bg:български|bgc:हरियाणवी|bho:भोजपुरी|blo:anii kagɩja|bm:bamanakan|bn:বাংলা|bo:བོད་སྐད་|br:brezhoneg|brx:बर’|bs:bosanski|bua:буряад|ca:català|ccp:𑄌𑄋𑄴𑄟𑄳𑄦|ce:нохчийн|cgg:Rukiga|chr:ᏣᎳᎩ|ckb:کوردیی ناوەندی|cs:čeština|csw:ᓀᐦᐃᓇᐍᐏᐣ|cv:чӑваш чӗлхи|cy:Cymraeg|da:dansk|dav:Kitaita|de:Deutsch|dje:Zarmaciine|doi:डोगरी|dsb:dolnoserbšćina|dua:duálá|dyo:joola|dz:རྫོང་ཁ|ebu:Kĩembu|ee:eʋegbe|el:Ελληνικά|es:español|et:eesti|eu:euskara|ewo:ewondo|fa:فارسی|ff:Pulaar|fi:suomi|fo:føroyskt|fr:français|fur:furlan|fy:Frysk|ga:Gaeilge|gaa:Gã|gd:Gàidhlig|gl:galego|gsw:Schwiizertüütsch|gu:ગુજરાતી|guz:Ekegusii|gv:Gaelg|haw:ʻŌlelo Hawaiʻi|he:עברית|hi:हिन्दी|hr:hrvatski|hsb:hornjoserbšćina|hu:magyar|hy:հայերեն|ia:interlingua|id:Indonesia|ii:ꆈꌠꉙ|is:íslenska|it:italiano|ja:日本語|jgo:Ndaꞌa|jmc:Kimachame|jv:Jawa|ka:ქართული|kab:Taqbaylit|kam:Kikamba|kde:Chimakonde|kea:kabuverdianu|kgp:kanhgág|khq:Koyra ciini|ki:Gikuyu|kk:қазақ тілі|kkj:kakɔ|kl:kalaallisut|km:ខ្មែរ|kn:ಕನ್ನಡ|ko:한국어|kok:कोंकणी|ks:کٲشُر|ksb:Kishambaa|ksf:rikpa|ksh:Kölsch|ku:kurdî (kurmancî)|kw:kernewek|kxv:kuvi|ky:кыргызча|lag:Kɨlaangi|lb:Lëtzebuergesch|lg:Luganda|lij:ligure|lkt:Lakȟólʼiyapi|ln:lingála|lo:ລາວ|lrc:لۊری شومالی|lt:lietuvių|lu:Tshiluba|luo:Dholuo|luy:Luluhia|lv:latviešu|mai:मैथिली|mas:Maa|mer:Kĩmĩrũ|mfe:kreol morisien|mgh:Makua|mgo:metaʼ|mk:македонски|ml:മലയാളം|mn:монгол|mni:মৈতৈলোন্|mr:मराठी|ms:Melayu|mt:Malti|mua:MUNDAŊ|my:မြန်မာ|mzn:مازرونی|naq:Khoekhoegowab|nb:norsk bokmål|nd:isiNdebele|nds:Neddersass’sch|ne:नेपाली|nl:Nederlands|nn:norsk nynorsk|nnh:Shwóŋò ngiembɔɔn|no:norsk|nqo:ߒߞߏ|nso:Sesotho sa Leboa|nus:Thok Nath|nyn:Runyankore|oc:occitan|om:Oromoo|or:ଓଡ଼ିଆ|os:ирон|pa:ਪੰਜਾਬੀ|pcm:Naijíriá Píjin|pl:polski|pms:piemontèis|prg:prūsiskan|ps:پښتو|pt:português|qu:Runasimi|raj:राजस्थानी|rm:rumantsch|rn:Ikirundi|ro:română|rof:Kihorombo|ru:русский|rw:Ikinyarwanda|rwk:Kiruwa|sa:संस्कृत भाषा|sah:саха тыла|saq:Kisampur|sat:ᱥᱟᱱᱛᱟᱲᱤ|sbp:Ishisangu|sc:sardu|scn:sicilianu|sd:سنڌي|se:davvisámegiella|seh:sena|ses:Koyraboro senni|sg:Sängö|shi:ⵜⴰⵛⵍⵃⵉⵜ|shn:တႆး|si:සිංහල|sk:slovenčina|sl:slovenščina|smn:anarâškielâ|sn:chiShona|so:Soomaali|sq:shqip|sr:српски|st:Sesotho|su:Basa Sunda|sv:svenska|sw:Kiswahili|syr:ܣܘܪܝܝܐ|szl:ślōnski|ta:தமிழ்|te:తెలుగు|teo:Kiteso|tg:тоҷикӣ|th:ไทย|ti:ትግርኛ|tk:türkmen dili|tn:Setswana|to:lea fakatonga|tok:toki pona|tr:Türkçe|tt:татар|twq:Tasawaq senni|tyv:Тыва|tzm:Tamaziɣt n laṭlaṣ|ug:ئۇيغۇرچە|uk:українська|ur:اردو|uz:o‘zbek|vai:ꕙꔤ|vec:veneto|vi:Tiếng Việt|vmw:emakhuwa|vun:Kyivunjo|xh:IsiXhosa|xnr:कांगड़ी|xog:Olusoga|yav:nuasue|yi:ייִדיש|yo:Èdè Yorùbá|yrl:nheẽgatu|yue:粵語|za:Vahcuengh|zgh:ⵜⴰⵎⴰⵣⵉⵖⵜ|zh:中文|zu:isiZulu';
  // end intl-names
  // Each table is read on the first name asked of it: most pages never ask.
  const SOURCES = {
    language: LANGUAGE_NAMES,
    region: REGION_NAMES,
    script: SCRIPT_NAMES,
    dialect: DIALECT_NAMES,
    own: OWN_NAMES,
  };
  const tables = {};
  const names = (k) =>
    (tables[k] ??= new Map(
      SOURCES[k].split('|').map((e) => [e.slice(0, e.indexOf(':')), e.slice(e.indexOf(':') + 1)]),
    ));
  class DisplayNames {
    constructor(locales, options = {}) {
      this._locale = pick(locales);
      this._o = options;
    }
    of(code) {
      const type = this._o.type;
      let name;
      if (type === 'region') name = names('region').get(String(code).toUpperCase());
      else if (type === 'script') name = names('script').get(canonical(`und-${code}`).slice(4));
      else if (type === 'language') {
        // "Serbian (Latin, Serbia)"; a dialect name ("American English") replaces the language
        // and one subtag unless the display is 'standard'.
        const [l, ...subs] = canonical(code).split('-');
        const own = lang(this._locale) === l && !subs.length && names('own').get(l);
        name = own || names('language').get(l);
        if (name && this._o.languageDisplay !== 'standard') {
          const i = subs.findIndex((s) => names('dialect').has(`${l}-${s}`));
          if (i >= 0) name = names('dialect').get(`${l}-${subs.splice(i, 1)[0]}`);
        }
        // A part's own parentheses become brackets: "Burmese (Myanmar [Burma])".
        const parts = subs.map((s) =>
          (names('script').get(s) ?? names('region').get(s) ?? s)
            .replace(/\(/g, '[')
            .replace(/\)/g, ']'),
        );
        if (name && parts.length) name += ` (${parts.join(', ')})`;
      }
      return name ?? (this._o.fallback === 'none' ? undefined : String(code));
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

  // Date's and Number's toLocale*String format as Intl does (QuickJS's ignore their locales and
  // options): a Date without date or time fields asked for gets numeric ones (ECMA-402's
  // ToDateTimeOptions).
  const DATE_FIELDS = ['weekday', 'year', 'month', 'day'],
    TIME_FIELDS = ['hour', 'minute', 'second'];
  const toLocale = (required, defaults) =>
    function (locales, options) {
      if (Number.isNaN(this.getTime())) return 'Invalid Date';
      const o = { ...options };
      const asked = (fields) => fields.some((k) => o[k] !== undefined);
      if (
        !(o.dateStyle || o.timeStyle) &&
        !(required !== 'time' && asked(DATE_FIELDS)) &&
        !(required !== 'date' && asked(TIME_FIELDS))
      ) {
        for (const k of defaults) o[k] = 'numeric';
      }
      return new DateTimeFormat(locales, o).format(this);
    };
  const method = (proto, name, fn) =>
    Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
  method(Date.prototype, 'toLocaleDateString', toLocale('date', ['year', 'month', 'day']));
  method(Date.prototype, 'toLocaleTimeString', toLocale('time', TIME_FIELDS));
  method(
    Date.prototype,
    'toLocaleString',
    toLocale('any', ['year', 'month', 'day', ...TIME_FIELDS]),
  );
  method(Number.prototype, 'toLocaleString', function (locales, options) {
    return new NumberFormat(locales, options).format(this);
  });
})();
