#!/bin/sh
# Installs Readest Lite as a KUAL extension (/mnt/us/extensions/readest-lite) on a jailbroken
# Kindle, over SSH: the binary from scripts/build-kindle.sh, the launcher in kindle/ and the fonts
# in KINDLE_FONTS. KOReader's SSH server (empty root password) is enough; KINDLE_HOST and
# KINDLE_PORT pick the device. scp is unreliable against its dropbear, so a tarball is streamed.
#
#   KINDLE_FONTS=DIR scripts/deploy-kindle.sh BINARY
set -e
cd "$(dirname "$0")/.."
bin=${1:?usage: KINDLE_FONTS=DIR deploy-kindle.sh BINARY}
fonts=${KINDLE_FONTS:?KINDLE_FONTS: a folder of .ttf/.otf/.ttc fonts to ship}
host=${KINDLE_HOST:-192.168.2.180} port=${KINDLE_PORT:-2222}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ext=$stage/readest-lite
mkdir -p "$ext/bin" "$ext/fonts"
cp kindle/config.xml kindle/menu.json kindle/run.sh "$ext/"
llvm-strip -o "$ext/bin/readest-lite" "$bin"
cp "$fonts"/*.[ot]t[fc] "$ext/fonts/"
printf '#!/bin/sh\necho\n' > "$stage/askpass"
chmod +x "$stage/askpass"

tar -C "$stage" -czf - readest-lite |
	DISPLAY=none SSH_ASKPASS="$stage/askpass" SSH_ASKPASS_REQUIRE=force \
		ssh -o PreferredAuthentications=password -o StrictHostKeyChecking=no -p "$port" "root@$host" \
		'rm -rf /mnt/us/extensions/readest-lite && tar -xzf - -C /mnt/us/extensions &&
		 ls -l /mnt/us/extensions/readest-lite /mnt/us/extensions/readest-lite/bin'
