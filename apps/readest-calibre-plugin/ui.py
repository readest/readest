__license__ = 'AGPL v3'
__copyright__ = '2026, The Readest Authors'

from qt.core import QMenu

from calibre.gui2 import error_dialog, info_dialog
from calibre.gui2.actions import InterfaceAction

from calibre_plugins.readest.api import ReadestClient
from calibre_plugins.readest.config import prefs, save_tokens
from calibre_plugins.readest.dialogs import LoginDialog, PushDialog


def make_client():
    return ReadestClient(
        api_base=prefs['api_base'],
        supabase_url=prefs['supabase_url'],
        tokens=prefs['tokens'],
        on_tokens=save_tokens,
    )


class ReadestInterfacePlugin(InterfaceAction):
    name = 'Readest Sync'
    action_spec = (
        'Readest',
        None,
        'Push selected books and metadata to your Readest library',
        None,
    )

    def genesis(self):
        self.push_action = self.create_action(
            spec=('Push selected books to Readest', None, None, None),
            attr='Push selected books to Readest',
        )
        self.push_action.triggered.connect(self.push_selected)

        self.login_action = self.create_action(
            spec=('Log in to Readest…', None, None, None), attr='Log in to Readest'
        )
        self.login_action.triggered.connect(self.login)

        self.logout_action = self.create_action(
            spec=('Log out', None, None, None), attr='Log out from Readest'
        )
        self.logout_action.triggered.connect(self.logout)

        self.config_action = self.create_action(
            spec=('Customize plugin…', None, None, None), attr='Customize Readest plugin'
        )
        self.config_action.triggered.connect(self.show_config)

        self.menu = QMenu(self.gui)
        self.menu.addAction(self.push_action)
        self.menu.addSeparator()
        self.menu.addAction(self.login_action)
        self.menu.addAction(self.logout_action)
        self.menu.addAction(self.config_action)
        self.menu.aboutToShow.connect(self.update_menu)

        self.qaction.setMenu(self.menu)
        self.qaction.setIcon(get_icons('images/icon.png', 'Readest Sync'))
        self.qaction.triggered.connect(self.push_selected)

    def update_menu(self):
        logged_in = bool(prefs['tokens'])
        email = prefs['user_email']
        self.login_action.setVisible(not logged_in)
        self.logout_action.setVisible(logged_in)
        if logged_in and email:
            self.logout_action.setText('Log out (%s)' % email)
        self.push_action.setEnabled(len(self.selected_book_ids()) > 0)

    def selected_book_ids(self):
        return self.gui.library_view.get_selected_ids()

    def push_selected(self):
        book_ids = self.selected_book_ids()
        if not book_ids:
            return error_dialog(
                self.gui, 'No books selected', 'Select the books to push to Readest.', show=True
            )
        if not prefs['tokens'] and not self.login():
            return
        PushDialog(
            self.gui,
            self.gui.current_db.new_api,
            book_ids,
            make_client(),
            bool(prefs['include_custom_columns']),
        ).exec()

    def login(self):
        dialog = LoginDialog(self.gui, make_client())
        if dialog.exec() != dialog.DialogCode.Accepted:
            return False
        user = dialog.user or {}
        prefs['user_email'] = user.get('email')
        info_dialog(
            self.gui,
            'Readest',
            'Logged in as %s.' % (user.get('email') or 'your Readest account'),
            show=True,
        )
        return True

    def logout(self):
        try:
            make_client().sign_out()
        finally:
            save_tokens(None)

    def show_config(self):
        self.interface_action_base_plugin.do_user_config(self.gui)
