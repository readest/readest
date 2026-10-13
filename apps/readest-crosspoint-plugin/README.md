# Readest plugin for CrossPoint

An [SD-card plugin](https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/sd-plugins.md)
for [CrossPoint](https://github.com/crosspoint-reader/crosspoint-reader) e-readers
(Xteink X3/X4 and other FreeInk devices) that connects the reader to your
[Readest](https://readest.com) account:

- **Library**: browse and search the EPUBs in your Readest cloud library on the
  reader and download them to `/Readest/` on the SD card.
- **Reading statistics**: every reading session on the reader (active reading
  time and how far you got) is added to your Readest reading statistics.
- **Reading progress**: the reader's built-in KOReader Sync syncs your position
  with Readest, with no sync server to set up.

## Requirements

- CrossPoint firmware with SD plugin support (the plugin system merged into
  `develop` on 2026-09-30; releases up to 1.6.5 do not include it).
- A Readest account. Any sign-in method works, since the reader never sees your
  password.
- Books uploaded to Readest Cloud. Only EPUBs are listed, since that is the
  format CrossPoint reads.

## Install

Download `Readest-<version>.crosspoint-plugin.zip` from the
[latest Readest release](https://github.com/readest/readest/releases/latest)
and unzip it. Copy the `readest/` folder to the SD card as
`/.crosspoint/plugins/readest/` (or `/plugins/readest/`), then restart the
reader.

## Update

The reader's plugin list shows the installed version under **Readest**, and
so does the **Readest** card on the web **Settings** page (see Sign in below
for opening it). On that card, select **Check for update**, then **Update**
when a newer release is available, and reload the page.

## Sign in

Signing in links the reader to your account with a code you approve on the
Readest web app. The reader gets its own key, which works only for this plugin
and is revoked when you sign out; your password is never stored on the reader.

On the reader, open **File Transfer**, join your Wi-Fi network, and open the
address it shows in a browser on your phone or computer. Go to **Settings**,
find the **Readest** card, and select **Sign in**. Open the link it shows, check
that the code matches, and select **Link Reader**.

Sign-in happens only on this web page, because CrossPoint lets a plugin set up
KOReader Sync from there but not from the reader's own screen. Until you sign
in, **Plugins → Readest** on the reader points you to the web page.

Your library then appears on the reader under **Plugins → Readest**. With
**Sync reading progress** on, signing in from the web page sets the reader's
**KOReader Sync** to sync progress with Readest. The box starts on unless
KOReader Sync is already set up with another server; turning it on replaces
that server. **Sign out** revokes the reader's key and clears KOReader Sync
only while it still points at Readest.

## Reading statistics

Reading sessions are queued on the reader and sent to Readest the next time it
is online: when File Transfer joins a network, or on the way to sleep if Wi-Fi
credentials for the last network are saved. Each session's time is spread over
the pages it covered, in the book's Readest page count, so it counts like
reading in Readest. Until a Readest app has opened the book, sessions are
counted in steps of 1% of the book. Books matching one in your Readest library
(the same file, identified by its KOReader-compatible partial MD5) merge with
that book's statistics, and so does a copy rewritten by **Optimize EPUB** once
its first **Sync Progress** has linked it (see Reading progress). Others appear
under their file hash.

## Reading progress

Signing in from the web page points CrossPoint's built-in KOReader Sync at
Readest (`/api/crosspoint`) with the reader's key, your email as the username,
and **Document Matching** set to **Binary** so books match Readest's
partial-MD5 book ids. The key alone authenticates the reader, so changing your
Readest email does not break sync. Sync from the reader menu with **Sync
Progress**; CrossPoint does not sync progress automatically. Readest apps move
to the synced position the next time they open the book (the furthest position
wins).

Positions travel as KOReader XPointers. Readest to CrossPoint lands on the right
page. CrossPoint to Readest lands one to three lines late on current CrossPoint
`develop`; CrossPoint PR #3424 makes it exact.

Sign-in also turns on KOReader Sync's **Send metadata**, so each upload carries
the book's title and authors. A book uploaded with the File Manager's
**Optimize EPUB** is rewritten, so it no longer matches Readest's copy by
partial MD5. Its first **Sync Progress** links it to the Readest EPUB with the
same title without moving Readest's position back. When titles collide, the
book must also share the first author, and of several such books (the same
book imported twice, or another edition) the most recently read one wins. The next sync brings Readest's position over, and from then on
it syncs both ways like the original.

## Development

Tests live with the app, in
`apps/readest-app/src/__tests__/crosspoint-plugin/readest-plugin.test.ts`. The
server side is the routes in `apps/readest-app/src/app/api/crosspoint/` (device
sign-in, catalog, reading sessions and the KOSync-compatible progress routes)
and the `/link` page where codes are approved. Reader keys and pending sign-ins
live in the tables from `docker/volumes/db/migrations/024_crosspoint_devices.sql`.
