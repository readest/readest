import gettext
import io
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import i18n  # noqa: E402

POT = '''msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "Login failed: %s"
msgstr ""

msgid "Log out"
msgstr ""

msgid "%d book"
msgid_plural "%d books"
msgstr[0] ""
msgstr[1] ""
'''

HEADER = '''msgid ""
msgstr ""
"Language: xx\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"
'''


class CompileTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self._saved_dir = i18n.TRANSLATIONS_DIR
        i18n.TRANSLATIONS_DIR = self.dir
        self.addCleanup(setattr, i18n, 'TRANSLATIONS_DIR', self._saved_dir)
        self.write('readest.pot', POT)

    def write(self, name, text):
        with open(os.path.join(self.dir, name), 'w', encoding='utf-8') as handle:
            handle.write(text)

    def mo_path(self, lang='xx'):
        return os.path.join(self.dir, lang + '.mo')

    def compile(self, *langs):
        with redirect_stdout(io.StringIO()):
            try:
                i18n.cmd_compile(langs)
            except SystemExit as err:
                # A message passed to SystemExit exits with status 1.
                return 1 if err.code else 0
        return 0

    def load(self, lang='xx'):
        with open(self.mo_path(lang), 'rb') as handle:
            return gettext.GNUTranslations(handle)

    def test_plural_form_missing_placeholder_fails_without_writing(self):
        self.write('xx.po', HEADER + '''
msgid "Login failed: %s"
msgstr "Fail: %s"

msgid "Log out"
msgstr "Out"

msgid "%d book"
msgid_plural "%d books"
msgstr[0] "one book"
msgstr[1] "%d books"
''')
        self.assertEqual(self.compile(), 1)
        self.assertFalse(os.path.exists(self.mo_path()))

    def test_singular_missing_placeholder_fails_without_writing(self):
        self.write('xx.po', HEADER + '''
msgid "Login failed: %s"
msgstr "Fail"
''')
        self.assertEqual(self.compile(), 1)
        self.assertFalse(os.path.exists(self.mo_path()))

    def test_fuzzy_and_untranslated_entries_fall_back_to_english(self):
        self.write('xx.po', HEADER + '''
#, fuzzy
msgid "Login failed: %s"
msgstr "Stale: %s"

msgid "Log out"
msgstr ""

msgid "%d book"
msgid_plural "%d books"
msgstr[0] "%d Buch"
msgstr[1] "%d Buecher"
''')
        self.assertEqual(self.compile(), 0)
        trans = self.load()
        self.assertEqual(trans.gettext('Login failed: %s'), 'Login failed: %s')
        self.assertEqual(trans.gettext('Log out'), 'Log out')
        self.assertEqual(trans.ngettext('%d book', '%d books', 3), '%d Buecher')

    def test_missing_messages_only_warn(self):
        self.write('xx.po', HEADER + '''
msgid "Log out"
msgstr "Out"
''')
        self.assertEqual(self.compile(), 0)
        self.assertEqual(self.load().gettext('Log out'), 'Out')

    def test_compiles_only_the_named_language(self):
        self.write('xx.po', HEADER + '\nmsgid "Log out"\nmsgstr "Out"\n')
        self.write('yy.po', HEADER.replace('xx', 'yy') + '\nmsgid "Log out"\nmsgstr "Aus"\n')
        self.assertEqual(self.compile('yy'), 0)
        self.assertFalse(os.path.exists(self.mo_path('xx')))
        self.assertTrue(os.path.exists(self.mo_path('yy')))


if __name__ == '__main__':
    unittest.main()
