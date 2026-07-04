NAME = Readest
VERSION = $(shell python3 -c "import re; \
	m = re.search(r'PLUGIN_VERSION = \((\d+), (\d+), (\d+)\)', open('__init__.py').read()); \
	print('.'.join(m.groups()))")
ZIP = dist/$(NAME)-$(VERSION).zip

FILES = __init__.py api.py config.py dialogs.py oauth.py ui.py wire.py worker.py \
	plugin-import-name-readest.txt images/icon.png

.PHONY: zip test install clean

zip: $(ZIP)

$(ZIP): $(FILES)
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
