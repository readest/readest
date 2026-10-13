NAME = Readest
# The app's package.json is the single source of truth for the version, the
# same one release.yml reads. `version` stamps it into __init__.py, which is
# what calibre shows in Preferences > Plugins.
VERSION = $(shell python3 -c "from sync_version import app_version; \
	print('.'.join(str(p) for p in app_version()))")
ZIP = dist/$(NAME)-$(VERSION).calibre-plugin.zip

# Derived from the .po files, so a new language's .mo is built before zipping.
MO = $(patsubst %.po,%.mo,$(wildcard translations/*.po))

FILES = __init__.py api.py config.py dialogs.py oauth.py ui.py wire.py worker.py \
	plugin-import-name-readest.txt images/icon.png $(MO)

.PHONY: zip version pot mo test install clean

zip: $(ZIP)

# Writes only when the version has drifted, so it never forces a rebuild.
version:
	@python3 sync_version.py

$(ZIP): $(FILES) | version
	mkdir -p dist
	rm -f $(ZIP)
	zip -q $(ZIP) $(FILES)
	@echo Built $(ZIP)

# Compile translations/*.po into the .mo files calibre loads at runtime.
# Keep the compiled .mo files in git: the release workflow only runs `make zip`.
mo:
	@python3 scripts/i18n.py compile

# Refresh translations/readest.pot after adding or changing _()/ngettext()
# strings in the source.
pot:
	@python3 scripts/i18n.py extract

# A stale .mo would ship untranslated strings, so recompile when its .po (or
# the compiler) is newer. Only that language: the output is deterministic, so
# a fresh checkout's mtimes just rewrite identical files.
translations/%.mo: translations/%.po scripts/i18n.py
	@python3 scripts/i18n.py compile $*

test:
	python3 -m unittest discover -s tests

# Load the plugin into a locally installed calibre for development.
install: zip
	calibre-customize -a $(ZIP)

clean:
	rm -rf dist
