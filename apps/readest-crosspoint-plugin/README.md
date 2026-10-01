# Readest plugin for CrossPoint

An [SD-card plugin](https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/sd-plugins.md)
for [CrossPoint](https://github.com/crosspoint-reader/crosspoint-reader) e-readers
(Xteink X3/X4 and other FreeInk devices) that connects the reader to your
[Readest](https://readest.com) account:

- **Library**: browse and search the EPUBs in your Readest cloud library on the
  reader and download them to `/Readest/` on the SD card.
- **Reading statistics**: every reading session on the reader (active reading
  time and how far you got) is added to your Readest reading statistics.

## Requirements

- CrossPoint firmware with SD plugin support (the plugin system merged into
  `develop` on 2026-09-30; releases up to 1.6.5 do not include it).
- A Readest account with an email and password. If you sign in to Readest with
  Google or Apple, set a password with **Forgot your password?** on the Readest
  sign-in page.
- Books uploaded to Readest Cloud. Only EPUBs are listed, since that is the
  format CrossPoint reads.

## Install

Copy the `readest/` folder to the SD card as `/.crosspoint/plugins/readest/`
(or `/plugins/readest/`), then restart the reader.

## Sign in

1. On the reader, open **File Transfer**, join your Wi-Fi network, and open the
   address it shows in a browser.
2. Go to **Settings**, find the **Readest** card, and sign in with your Readest
   email and password.

Your library then appears on the reader under **Plugins → Readest**.

The password is stored on the SD card so the reader can renew its sign-in when
the access token expires. It is kept in a dotfile that the reader's web server
refuses to serve, but anyone holding the SD card can read it. **Sign out** on
the same card removes it.

## Reading statistics

Reading sessions are queued on the reader and sent to Readest the next time it
is online: when File Transfer joins a network, or on the way to sleep if Wi-Fi
credentials for the last network are saved. Sessions are counted for any EPUB
you read on the reader. Books matching one in your Readest library (the same
file, identified by its KOReader-compatible partial MD5) merge with that
book's statistics; others appear under their file hash.

## Reading progress

Progress sync does not need this plugin. Use CrossPoint's built-in **KOReader
Sync** with the same KOSync server you use in Readest, and set **Document
Matching** to **Binary**: Readest identifies books by their partial MD5, not by
file name.

## Development

Tests live with the app, in
`apps/readest-app/src/__tests__/crosspoint-plugin/readest-plugin.test.ts`, and
the library listing the plugin browses is `GET /api/library/books`
(`apps/readest-app/src/app/api/library/books/route.ts`).
