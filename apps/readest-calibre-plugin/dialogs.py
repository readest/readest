__license__ = 'AGPL v3'
__copyright__ = '2026, The Readest Authors'

from qt.core import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QProgressBar,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QThread,
    QUrl,
    QVBoxLayout,
    pyqtSignal,
)

from calibre.gui2 import error_dialog, open_url

from calibre_plugins.readest.api import ReadestAPIError
from calibre_plugins.readest.oauth import PROVIDERS, OAuthCallbackServer, build_authorize_url
from calibre_plugins.readest.worker import STATUS_LABELS, PushWorker

OAUTH_WAIT_SECONDS = 300


class _OAuthWaiter(QThread):
    got_tokens = pyqtSignal(dict)
    timed_out = pyqtSignal()

    def __init__(self, parent, server):
        QThread.__init__(self, parent)
        self.server = server

    def run(self):
        tokens = self.server.wait(OAUTH_WAIT_SECONDS)
        if tokens:
            self.got_tokens.emit(tokens)
        else:
            self.timed_out.emit()


class LoginDialog(QDialog):
    """Email/password login plus browser OAuth (Google, Apple, GitHub, Discord)."""

    def __init__(self, parent, client):
        QDialog.__init__(self, parent)
        self.client = client
        self.user = None
        self.oauth_server = None
        self.oauth_waiter = None

        self.setWindowTitle('Log in to Readest')
        layout = QVBoxLayout()
        self.setLayout(layout)

        form = QFormLayout()
        self.email_edit = QLineEdit(self)
        self.password_edit = QLineEdit(self)
        self.password_edit.setEchoMode(QLineEdit.EchoMode.Password)
        form.addRow('Email:', self.email_edit)
        form.addRow('Password:', self.password_edit)
        layout.addLayout(form)

        self.login_btn = QPushButton('Log in', self)
        self.login_btn.clicked.connect(self.password_login)
        layout.addWidget(self.login_btn)

        layout.addWidget(QLabel('Or sign in with your browser:'))
        providers_layout = QHBoxLayout()
        for provider in PROVIDERS:
            btn = QPushButton(provider.capitalize(), self)
            btn.clicked.connect(lambda _=False, p=provider: self.oauth_login(p))
            providers_layout.addWidget(btn)
        layout.addLayout(providers_layout)

        self.status_label = QLabel('')
        self.status_label.setWordWrap(True)
        layout.addWidget(self.status_label)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def password_login(self):
        email = self.email_edit.text().strip()
        password = self.password_edit.text()
        if not email or not password:
            self.status_label.setText('Please enter both email and password.')
            return
        self.status_label.setText('Logging in…')
        self.login_btn.setEnabled(False)
        try:
            self.user = self.client.sign_in_password(email, password)
        except ReadestAPIError as err:
            self.status_label.setText('Login failed: %s' % err)
            self.login_btn.setEnabled(True)
            return
        self.accept()

    def oauth_login(self, provider):
        self.stop_oauth()
        self.oauth_server = OAuthCallbackServer()
        port = self.oauth_server.start()
        self.oauth_waiter = _OAuthWaiter(self, self.oauth_server)
        self.oauth_waiter.got_tokens.connect(self.oauth_finished)
        self.oauth_waiter.timed_out.connect(
            lambda: self.status_label.setText('Browser login timed out. Try again.')
        )
        self.oauth_waiter.start()
        self.status_label.setText('Waiting for the browser login to complete…')
        open_url(QUrl(build_authorize_url(self.client.supabase_url, provider, port)))

    def oauth_finished(self, tokens):
        if tokens.get('error'):
            self.status_label.setText(
                'Login failed: %s' % (tokens.get('error_description') or tokens['error'])
            )
            return
        if not tokens.get('access_token') or not tokens.get('refresh_token'):
            self.status_label.setText('Login failed: the browser callback carried no session.')
            return
        self.client.set_session(tokens)
        try:
            self.user = self.client.get_user()
        except ReadestAPIError as err:
            self.status_label.setText('Login failed: %s' % err)
            return
        self.accept()

    def stop_oauth(self):
        # Disconnect before stopping: stop() wakes the waiter thread, and its
        # signals must not fire into a dialog that is going away.
        if self.oauth_waiter:
            try:
                self.oauth_waiter.got_tokens.disconnect()
                self.oauth_waiter.timed_out.disconnect()
            except TypeError:
                pass
        if self.oauth_server:
            self.oauth_server.stop()
            self.oauth_server = None
        if self.oauth_waiter:
            self.oauth_waiter.wait(2000)
            self.oauth_waiter = None

    def done(self, result):
        self.stop_oauth()
        QDialog.done(self, result)


class PushDialog(QDialog):
    """Per-book status table for a push run, modeled on BookFusion's sync log."""

    def __init__(self, parent, db, book_ids, client, include_custom_columns):
        QDialog.__init__(self, parent)
        self.db = db
        self.worker = PushWorker(self, db, book_ids, client, include_custom_columns)
        self.worker.progress.connect(self.on_progress)
        self.worker.book_status.connect(self.on_book_status)
        self.worker.done.connect(self.on_done)

        self.setWindowTitle('Push to Readest')
        self.setMinimumSize(520, 380)
        layout = QVBoxLayout()
        self.setLayout(layout)

        count = len(book_ids)
        layout.addWidget(
            QLabel('Pushing %d %s to your Readest library…' % (count, _plural(count)))
        )

        self.progress_bar = QProgressBar(self)
        self.progress_bar.setRange(0, count)
        layout.addWidget(self.progress_bar)

        self.table = QTableWidget(0, 3, self)
        self.table.setHorizontalHeaderLabels(['Book', 'Status', 'Details'])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setColumnWidth(0, 220)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        self.summary_label = QLabel('')
        self.summary_label.setWordWrap(True)
        layout.addWidget(self.summary_label)

        self.buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel)
        self.buttons.rejected.connect(self.reject)
        layout.addWidget(self.buttons)

        self.worker.start()

    def on_progress(self, done, total):
        self.progress_bar.setValue(done)

    def on_book_status(self, book_id, status, detail):
        title = self.db.field_for('title', book_id) or 'Unknown'
        row = self.table.rowCount()
        self.table.insertRow(row)
        self.table.setItem(row, 0, QTableWidgetItem(title))
        self.table.setItem(row, 1, QTableWidgetItem(STATUS_LABELS.get(status, status)))
        self.table.setItem(row, 2, QTableWidgetItem(detail))
        self.table.scrollToBottom()

    def on_done(self, ok, message):
        self.progress_bar.setValue(self.progress_bar.maximum())
        self.summary_label.setText(message)
        self.buttons.setStandardButtons(QDialogButtonBox.StandardButton.Close)
        if not ok and self.table.rowCount() == 0:
            error_dialog(self, 'Push to Readest failed', message, show=True)

    def reject(self):
        if self.worker.isRunning():
            self.worker.cancel()
            self.summary_label.setText('Canceling…')
            return
        QDialog.reject(self)


def _plural(count):
    return 'book' if count == 1 else 'books'
