__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

from calibre.customize import InterfaceActionBase

PLUGIN_VERSION = (0, 1, 0)


class ReadestPlugin(InterfaceActionBase):
    name = 'Readest Sync'
    description = (
        'Push selected books and their metadata into your Readest cloud library. '
        'Re-pushing a book updates its existing entry instead of creating a duplicate.'
    )
    supported_platforms = ['windows', 'osx', 'linux']
    author = 'Bilingify LLC'
    version = PLUGIN_VERSION
    minimum_calibre_version = (6, 0, 0)

    actual_plugin = 'calibre_plugins.readest.ui:ReadestInterfacePlugin'

    def is_customizable(self):
        return True

    def config_widget(self):
        from calibre_plugins.readest.config import ConfigWidget

        return ConfigWidget()

    def save_settings(self, config_widget):
        config_widget.save_settings()
