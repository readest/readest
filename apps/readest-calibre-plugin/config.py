__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

from calibre.utils.config import JSONConfig
from qt.core import QCheckBox, QLabel, QLineEdit, QVBoxLayout, QWidget

from calibre_plugins.readest.api import DEFAULT_API_BASE, DEFAULT_SUPABASE_URL

prefs = JSONConfig('plugins/readest')

prefs.defaults['api_base'] = DEFAULT_API_BASE
prefs.defaults['supabase_url'] = DEFAULT_SUPABASE_URL
prefs.defaults['tokens'] = None  # {access_token, refresh_token, expires_at, expires_in}
prefs.defaults['user_email'] = None
prefs.defaults['include_custom_columns'] = True


def save_tokens(tokens):
    prefs['tokens'] = tokens
    if tokens is None:
        prefs['user_email'] = None


class ConfigWidget(QWidget):
    def __init__(self):
        QWidget.__init__(self)
        layout = QVBoxLayout()
        self.setLayout(layout)

        account = prefs['user_email']
        status = ('Logged in as %s.' % account) if account else 'Not logged in.'
        layout.addWidget(QLabel(status + ' Use the Readest toolbar menu to log in or out.'))

        self.custom_columns_checkbox = QCheckBox('Include custom columns in pushed metadata')
        self.custom_columns_checkbox.setChecked(bool(prefs['include_custom_columns']))
        layout.addWidget(self.custom_columns_checkbox)

        layout.addWidget(QLabel('API server:'))
        self.api_base_edit = QLineEdit(self)
        self.api_base_edit.setText(prefs['api_base'])
        self.api_base_edit.setToolTip(
            'Only change this if you run a self-hosted Readest server.'
        )
        layout.addWidget(self.api_base_edit)

        layout.addStretch()

    def save_settings(self):
        prefs['include_custom_columns'] = self.custom_columns_checkbox.isChecked()
        prefs['api_base'] = self.api_base_edit.text().strip() or DEFAULT_API_BASE
