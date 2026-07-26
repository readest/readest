NAME = Readest
# The app's package.json is the single source of truth for the version, the
# same one release.yml reads. `version` stamps it into __init__.py, which is
# what calibre shows in Preferences > Plugins.
VERSION = $(shell python3 -c "from sync_version import app_version; \
	print('.'.join(str(p) for p in app_version()))")
ZIP = dist/$(NAME)-$(VERSION).calibre-plugin.zip

FILES = __init__.py api.py config.py dialogs.py oauth.py ui.py wire.py worker.py \
	plugin-import-name-readest.txt images/icon.png

.PHONY: zip version test install clean

zip: $(ZIP)

# Writes only when the version has drifted, so it never forces a rebuild.
version:
	@python3 sync_version.py

$(ZIP): $(FILES) | version
	mkdir -p dist
	rm -f $(ZIP)
	zip -q $(ZIP) $(FILES)
	@echo Built $(ZIP)

test:
	python3 -m unittest discover -s tests

# Load the plugin into a locally installed calibre for development.
install: zip
	calibre-customize -a $(ZIP)

clean:
	rm -rf dist
