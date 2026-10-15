#!/usr/bin/env python3
"""i18n tooling for the Readest calibre plugin.

calibre loads a plugin's translations from `translations/<lang>.mo` inside the
plugin zip, where `<lang>` is the UI language code from calibre's
Preferences -> Look & Feel (see calibre.customize.zipplugin.load_translations).
The `.po` files in `translations/` are the source of truth; this script
extracts msgids from the plugin source into `readest.pot` and compiles each
`.po` to the `.mo` that ships in the zip.

Usage:
    python3 scripts/i18n.py extract        # refresh translations/readest.pot
    python3 scripts/i18n.py compile [LANG ...]  # .po -> .mo (default: every language)
    python3 scripts/i18n.py new LANG       # scaffold translations/LANG.po

Marking strings in the source: wrap user-visible text in `_()` (singular) or
`ngettext(singular, plural, n)` (plural). Each module that calls `_()` must
first call `load_translations()` at the top, which calibre injects into the
module namespace when it loads the plugin from its zip.
"""

import ast
import os
import re
import struct
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.normpath(os.path.join(HERE, os.pardir))
TRANSLATIONS_DIR = os.path.join(PLUGIN_DIR, 'translations')
POT_NAME = 'readest.pot'

# Scanned for translatable strings: every plugin module, so a stray `_()` in
# the pure-logic modules (which never call load_translations()) still shows up
# in the .pot and gets noticed.
SOURCES = (
    '__init__.py',
    'api.py',
    'config.py',
    'dialogs.py',
    'oauth.py',
    'ui.py',
    'wire.py',
    'worker.py',
)

# Plural-Forms header value per language, for `new` and for validating the
# msgstr[N] counts. Mirrors the CLDR plural rules calibre's own translations
# use. Languages absent here fall back to the two-form English rule.
PLURAL_FORMS = {
    'de': 'nplurals=2; plural=(n != 1);',
    'en': 'nplurals=2; plural=(n != 1);',
    'fr': 'nplurals=2; plural=(n > 1);',
    'ja': 'nplurals=1; plural=0;',
    'ko': 'nplurals=1; plural=0;',
    'ru': 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 '
          '&& (n%100<10 || n%100>=20) ? 1 : 2);',
    'zh_CN': 'nplurals=1; plural=0;',
    'zh_TW': 'nplurals=1; plural=0;',
}

PO_HEADER_TEMPLATE = '''# {title}
# Copyright (C) 2026 Bilingify LLC
# This file is distributed under the same license as the Readest calibre plugin.
#
msgid ""
msgstr ""
"Project-Id-Version: Readest calibre plugin\\n"
"Report-Msgid-Bugs-To: \\n"
"POT-Creation-Date: {created}\\n"
"PO-Revision-Date: {revised}\\n"
"Last-Translator: {translator}\\n"
"Language-Team: {team}\\n"
"Language: {lang}\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Plural-Forms: {plural_forms}\\n"
'''

_MO_MAGIC = 0x950412DE


def _escape(text):
    return (
        text.replace('\\', '\\\\')
        .replace('"', '\\"')
        .replace('\n', '\\n')
        .replace('\t', '\\t')
        .replace('\r', '\\r')
    )


_ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', 'a': '\a', 'b': '\b', 'f': '\f', 'v': '\v'}


def _unescape(text):
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == '\\' and i + 1 < len(text):
            nxt = text[i + 1]
            out.append(_ESCAPES.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return ''.join(out)


def _quote(text):
    return '"%s"' % _escape(text)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


def _string_literal(node):
    """Value of a string literal node (implicit concatenation included), else None."""
    try:
        value = ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError):
        return None
    return value if isinstance(value, str) else None


def extract_messages():
    """[(msgid, msgid_plural, [ref, ...])] in first-seen order across SOURCES."""
    entries = {}

    def record(msgid, plural, ref):
        entry = entries.get(msgid)
        if entry is None:
            entries[msgid] = [plural, [ref]]
        else:
            if entry[0] != plural:
                raise SystemExit(
                    'error: %r is used both as singular and plural (or with a '
                    'different plural) in %s' % (msgid, ref)
                )
            if ref not in entry[1]:
                entry[1].append(ref)

    for name in SOURCES:
        path = os.path.join(PLUGIN_DIR, name)
        with open(path, encoding='utf-8') as handle:
            tree = ast.parse(handle.read(), filename=name)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            ref = '%s:%d' % (name, node.lineno)
            if node.func.id == '_' and len(node.args) == 1:
                msgid = _string_literal(node.args[0])
                if msgid is not None:
                    record(msgid, None, ref)
            elif node.func.id == 'ngettext' and len(node.args) >= 2:
                singular = _string_literal(node.args[0])
                plural = _string_literal(node.args[1])
                if singular is not None and plural is not None:
                    record(singular, plural, ref)
    return [(msgid, entry[0], entry[1]) for msgid, entry in entries.items()]


def _entry_lines(msgid, plural, refs, msgstrs):
    lines = ['#: %s' % ' '.join(refs)]
    lines.append('msgid %s' % _quote(msgid))
    if plural is not None:
        lines.append('msgid_plural %s' % _quote(plural))
        for index, text in enumerate(msgstrs):
            lines.append('msgstr[%d] %s' % (index, _quote(text)))
    else:
        lines.append('msgstr %s' % _quote(msgstrs[0] if msgstrs else ''))
    return lines


def _pot_header():
    created = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M+0000')
    return PO_HEADER_TEMPLATE.format(
        title='Translations template for the Readest calibre plugin.',
        created=created,
        revised='',
        translator='',
        team='',
        lang='',
        plural_forms=PLURAL_FORMS['en'],
    )


def cmd_extract():
    messages = extract_messages()
    lines = [_pot_header().rstrip('\n')]
    for msgid, plural, refs in messages:
        lines.append('')
        lines.extend(_entry_lines(msgid, plural, refs, [''] * (2 if plural else 1)))
    path = os.path.join(TRANSLATIONS_DIR, POT_NAME)
    os.makedirs(TRANSLATIONS_DIR, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(lines) + '\n')
    plural_count = sum(1 for _, plural, _ in messages if plural)
    print('%s: %d messages (%d with plurals)' % (POT_NAME, len(messages), plural_count))


# ---------------------------------------------------------------------------
# .po parsing
# ---------------------------------------------------------------------------

_FIELD_RE = re.compile(r'^(msgid|msgid_plural|msgstr|msgstr\[(\d+)\])\s+(.*)$')


def parse_po(path):
    """(header dict, header text, [(msgid, msgid_plural, [msgstr, ...]), ...]).

    The header text is the msgstr of the empty msgid verbatim, so it can be
    written back into the .mo unchanged.
    """
    with open(path, encoding='utf-8') as handle:
        lines = handle.read().splitlines()

    header = {}
    header_text = ''
    entries = []
    msgid = None
    msgid_plural = None
    parts = None
    field = None
    part = None
    fuzzy = False
    next_fuzzy = False

    def end_entry():
        nonlocal msgid, msgid_plural, parts, header_text
        if msgid is None:
            return
        if msgid == '':
            header_text = parts[0] if parts else ''
            header.update(_parse_header(header_text))
        else:
            # Like msgfmt, a fuzzy translation is treated as untranslated.
            if fuzzy:
                parts = [''] * len(parts or [])
            entries.append((msgid, msgid_plural, parts or []))
        msgid = None
        msgid_plural = None
        parts = None

    for lineno, raw in enumerate(lines, 1):
        line = raw.strip()
        if line.startswith('#,') and 'fuzzy' in line:
            next_fuzzy = True
        if not line or line.startswith('#'):
            if not line:
                end_entry()
                field = None
            continue
        if line.startswith('"'):
            if field is None:
                raise SystemExit('%s:%d: continuation line outside a field' % (path, lineno))
            value = _unescape(line[1:line.rindex('"')])
            if field == 'msgid':
                msgid += value
            elif field == 'msgid_plural':
                msgid_plural += value
            elif part is None:
                parts[-1] += value
            else:
                parts[part] += value
            continue
        match = _FIELD_RE.match(line)
        if match is None:
            raise SystemExit('%s:%d: cannot parse line: %r' % (path, lineno, line))
        keyword, index = match.group(1), match.group(2)
        value = match.group(3)
        if not (value.startswith('"') and value.endswith('"')) or len(value) < 2:
            raise SystemExit('%s:%d: expected a quoted string: %r' % (path, lineno, line))
        value = _unescape(value[1:-1])
        if keyword == 'msgid':
            end_entry()
            msgid, msgid_plural, parts = value, None, None
            fuzzy, next_fuzzy = next_fuzzy, False
            field = 'msgid'
        elif keyword == 'msgid_plural':
            msgid_plural, field = value, 'msgid_plural'
        else:
            if parts is None:
                parts = []
            if keyword == 'msgstr':
                part = None
                parts.append(value)
            else:
                part = int(index)
                while len(parts) <= part:
                    parts.append('')
                parts[part] = value
            field = 'msgstr'
    end_entry()
    return header, header_text, entries


def _parse_header(text):
    header = {}
    for line in text.splitlines():
        if ':' in line:
            key, _, value = line.partition(':')
            header[key.strip()] = value.strip()
    return header


# ---------------------------------------------------------------------------
# .mo generation
# ---------------------------------------------------------------------------


def generate_mo(catalog):
    """GNU .mo bytes from {msgid: msgstr}; plural msgids carry \\x00 and their
    msgstr carries one \\x00-separated form per plural."""
    keys = sorted(catalog)
    count = len(keys)
    orig_table_offset = 7 * 4
    trans_table_offset = orig_table_offset + 8 * count
    ids_blob = b''
    strs_blob = b''
    orig_entries = []
    trans_entries = []
    for key in keys:
        msgid = key.encode('utf-8')
        msgstr = catalog[key].encode('utf-8')
        orig_entries.append((len(msgid), len(ids_blob)))
        trans_entries.append((len(msgstr), len(strs_blob)))
        ids_blob += msgid + b'\x00'
        strs_blob += msgstr + b'\x00'
    ids_offset = trans_table_offset + 8 * count
    strs_offset = ids_offset + len(ids_blob)

    out = [struct.pack('<IIIIIII', _MO_MAGIC, 0, count, orig_table_offset,
                       trans_table_offset, 0, 0)]
    for length, offset in orig_entries:
        out.append(struct.pack('<II', length, offset + ids_offset))
    for length, offset in trans_entries:
        out.append(struct.pack('<II', length, offset + strs_offset))
    out.append(ids_blob)
    out.append(strs_blob)
    return b''.join(out)


_PLACEHOLDER_RE = re.compile(r'%(?:%|[sd])')


def _placeholders(text):
    return sorted(_PLACEHOLDER_RE.findall(text))


def cmd_compile(langs=()):
    """Compile `langs` (default: every .po) to .mo.

    A catalog with errors gets no .mo, so make keeps it stale and fails again
    on the next run instead of shipping it. Messages missing from a catalog
    only warn: calibre shows them in English.
    """
    pot_path = os.path.join(TRANSLATIONS_DIR, POT_NAME)
    _, _, pot_entries = parse_po(pot_path)
    expected = {msgid for msgid, _, _ in pot_entries}

    names = [lang + '.po' for lang in langs] or sorted(
        name for name in os.listdir(TRANSLATIONS_DIR) if name.endswith('.po')
    )
    failed = []
    for name in names:
        lang = name[:-3]
        path = os.path.join(TRANSLATIONS_DIR, name)
        header, header_text, entries = parse_po(path)
        errors = []
        warnings = []
        if header.get('Language', lang) != lang:
            errors.append('header Language %r does not match the file name'
                          % header.get('Language'))
        nplurals = 2
        forms = header.get('Plural-Forms', '')
        match = re.search(r'nplurals\s*=\s*(\d+)', forms)
        if match:
            nplurals = int(match.group(1))

        catalog = {'': header_text}
        seen = set()
        untranslated = 0
        for msgid, plural, parts in entries:
            if msgid in seen:
                errors.append('duplicate msgid %r' % msgid)
            seen.add(msgid)
            if plural is None:
                parts = parts[:1] or ['']
            elif len(parts) != nplurals:
                errors.append('%r has %d forms, Plural-Forms says %d'
                              % (msgid, len(parts), nplurals))
            # gettext returns an empty msgstr as-is, so leave untranslated
            # messages out of the .mo and let them fall back to English.
            if not all(parts):
                untranslated += 1
                continue
            # A form that drops or adds a placeholder raises TypeError at the
            # `%` that formats it in the plugin.
            if any(_placeholders(text) != _placeholders(plural or msgid) for text in parts):
                errors.append('%r placeholders differ between msgid and msgstr' % msgid)
            catalog[msgid + '\x00' + plural if plural else msgid] = '\x00'.join(parts)

        missing = sorted(expected - seen)
        if missing:
            warnings.append('%d message(s) missing, first: %r' % (len(missing), missing[0]))
        extra = sorted(seen - expected)
        if extra:
            warnings.append('%d message(s) not in the .pot, first: %r' % (len(extra), extra[0]))
        for warning in warnings:
            print('warning: %s: %s' % (name, warning))
        for error in errors:
            print('error: %s: %s' % (name, error))
        if errors:
            failed.append(name)
            continue

        with open(os.path.join(TRANSLATIONS_DIR, lang + '.mo'), 'wb') as handle:
            handle.write(generate_mo(catalog))
        print('%s.mo: %d messages, %d untranslated' % (lang, len(seen), untranslated))

    if failed:
        raise SystemExit('not compiled: %s' % ', '.join(failed))
    print('compiled %d language(s)' % len(names))


def cmd_new(lang):
    _, _, entries = parse_po(os.path.join(TRANSLATIONS_DIR, POT_NAME))
    path = os.path.join(TRANSLATIONS_DIR, lang + '.po')
    if os.path.exists(path):
        raise SystemExit('error: %s already exists' % path)
    forms = PLURAL_FORMS.get(lang, PLURAL_FORMS['en'])
    lines = [PO_HEADER_TEMPLATE.format(
        title='%s translation for the Readest calibre plugin.' % lang,
        created=datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M+0000'),
        revised='',
        translator='',
        team='',
        lang=lang,
        plural_forms=forms,
    ).rstrip('\n')]
    for msgid, plural, refs in entries:
        lines.append('')
        lines.extend(_entry_lines(msgid, plural, refs, [''] * (2 if plural else 1)))
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(lines) + '\n')
    print('created %s with %d messages' % (path, len(entries)))


def main(argv):
    if len(argv) < 2 or argv[1] not in ('extract', 'compile', 'new'):
        print(__doc__)
        return 2
    command = argv[1]
    if command == 'extract':
        cmd_extract()
    elif command == 'compile':
        cmd_compile(argv[2:])
    else:
        if len(argv) != 3:
            print('usage: i18n.py new LANG')
            return 2
        cmd_new(argv[2])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
