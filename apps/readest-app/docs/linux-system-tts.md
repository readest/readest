# Linux system voices

Read Aloud can use the voices installed in Speech Dispatcher. Text goes to the
local daemon over its Unix socket; the selected Speech Dispatcher module controls
synthesis. Install a local module such as eSpeak NG or configure Piper through a
Speech Dispatcher module (for example with Pied) to read offline.

On Debian and Ubuntu:

```sh
sudo apt install speech-dispatcher speech-dispatcher-espeak-ng
spd-say --wait --language en 'Local speech is ready.'
```

Open a book, start **Read Aloud**, and choose a voice under **System TTS** in the
voice picker. Voices keep their Speech Dispatcher names ("English (America)"), and
eSpeak NG voices are listed once, without their per-variant copies; when more than
one module has voices, each name also shows its module. Voice selection, speed, sentence
highlighting, and stopping use the existing player controls. Pause stops the
sentence and Play reads it again from its start, as on Android.
There are no word timings or downloadable audio for these voices. Speech Dispatcher
rates are engine-relative, so the audible speed depends on the installed module.

Readest connects at `$XDG_RUNTIME_DIR/speech-dispatcher/speechd.sock` (falling back
to `$XDG_CACHE_HOME`, then `~/.cache`). A custom local socket can be selected with
`SPEECHD_ADDRESS=unix_socket:/absolute/path/to/speechd.sock`. Outside Flatpak, Readest
tries `speech-dispatcher --spawn` if the daemon is not running. Custom socket paths
must match the daemon's configuration for autospawn to succeed. `SPEECHD_CMD` can
select a different daemon executable. If the daemon or voices are unavailable,
the other Read Aloud engines remain available.

## AppImage

Install Speech Dispatcher and a voice module on the host. The AppImage connects to
the host daemon without bundling a speech library, engine, or models.

## Flatpak

The host must have Speech Dispatcher running with at least one voice module. The
Flatpak manifest needs this entry in `finish-args`:

```yaml
- --filesystem=xdg-run/speech-dispatcher:ro
```

The manifest is maintained separately in
[flathub/com.bilingify.readest](https://github.com/flathub/com.bilingify.readest).
For a package whose manifest has not yet added the permission:

```sh
flatpak override --user --filesystem=xdg-run/speech-dispatcher:ro com.bilingify.readest
```

The read-only directory mount allows connecting to the socket. Readest does not
start a second daemon inside the sandbox. A custom socket outside this directory
also needs explicit Flatpak filesystem access.
