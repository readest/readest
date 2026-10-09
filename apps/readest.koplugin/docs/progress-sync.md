# Reading progress sync

The KOReader plugin synchronizes reading positions with Readest. Sync requires
a signed-in session and a document that can be identified in the library.
Automatic sync also requires the auto-sync setting to be enabled.

## Automatic and manual sync

Page turns schedule an automatic push after five seconds of inactivity.
Automatic pushes are limited by a 30-second debounce; a pending update is
scheduled for the remaining interval. Closing a book bypasses the debounce and
captures its final position immediately. Continuous page turning can postpone
the inactivity timer, so closing the book is an important sync trigger.

Automatic pulls move reading progress forward only. Responses are ignored if
the reader has continued reading since the request or the document has closed.
EPUB pulls compare the logical XPointer, so reflow, rotation, or font changes
do not discard a response merely because the rendered page number changed.
Fixed-page documents still compare page numbers.
An explicit manual pull can also move to an earlier position, but only to an
exact one: a page number, or an EPUB XPointer that resolves without trimming.
A trimmed XPointer only resolves to a parent node such as the chapter start,
so it never moves the reader backward. Trimming stops above `/body`, which
resolves in any book, so a position whose chapter is missing counts as
unusable. If the saved position cannot be used in the current document, the
plugin reports that limitation instead of reporting successful
synchronization.

Pushes retain the identity and settings of the book they were created for.
Opening another book while a push is running does not redirect its completion
metadata to the new book.

## Authentication and request handling

Progress, annotation, statistics and library sync all go through the same
authenticated client. Sync operations wait for an expired access token to
refresh before sending requests. Concurrent operations share one refresh. If a request rejects an
access token, the plugin refreshes and retries once, or uses a token already
refreshed by another request. Refresh results from an old session are ignored
after logout or a new login.

Transient refresh failures preserve the session. Rejected refresh tokens
require a new login. Refreshed tokens are flushed to disk so they survive an
unclean exit.

If authentication still fails after one refresh/retry, the plugin pauses sync,
removes the rejected access token, and prompts once to log in again. It keeps
the refresh token without using it again until login; the pause persists across
restarts. A successful login clears the pause. Other 403 errors, such as quota
or permission denials, do not refresh tokens or pause the session.

Rejected tokens are cleared before failure callbacks run. The login prompt is
shown after those callbacks, and sync operations suppress redundant auth-failure
toasts so concurrent failures cannot cover the prompt.

HTTP requests have deadlines. Token refreshes release waiting sync operations
after 20 seconds, but keep the in-flight request so a late successful token
rotation is still saved. Another refresh cannot start for that session until
the request finishes or reaches its 150-second hard limit, after which the
request is ended (the background worker is terminated without Turbo) and the
next sync starts a new refresh. A rotation lost to that limit requires a new
login. Each waiting sync operation completes at most once.

Token expiry is tracked on the device clock (`expires_in` from the response),
so a device clock that is wrong does not force a refresh on every sync.

Read RPCs retry transient timeouts once. Automatic progress pushes have one
delayed retry, and failed progress is retained for reconnect. Writes are not
indiscriminately replayed after ambiguous transport errors. Wi-Fi connectivity
alone does not guarantee success: DNS, TLS, rate limits, service outages, and
database errors can still prevent synchronization.

## Position identity and conflict handling

Progress pushes resolve the library's book identity before constructing the
payload, including when a local PDF metadata hash differs from the library's
stamped hash. Documents without a checksum cannot be identified for sync.

The server merges configuration using timestamps. The plugin orders local
pushes within the same second, with at most one second of clock advancement.
It discards persisted clocks beyond that bound and does not adopt timestamps
from remote records. When the server keeps another device's position, the
plugin respects that merge without re-pushing at a fabricated newer timestamp.
Only the latest push for a book updates completion state or schedules retries.
Moving the local clock backward also resets the push debounce and allows
resume sync to proceed.

Device clocks still affect last-writer-wins. A future-dated record already on
the server can continue to win until its timestamp is corrected or wall time
catches up; recovering such records reliably requires server clock validation
or version-based conflict handling.

Saved positions are validated before application. Empty or malformed positions,
invalid EPUB XPointers, and PDF positions outside the local page range cannot
be applied reliably.

## Cross-device limitations

Use the same book file on both devices when diagnosing position mismatches.
Different metadata hashes can prevent identity matching. Different editions or
document structures can make positions incompatible even when metadata matches.

KOReader needs a usable EPUB XPointer. It cannot apply a remote iPhone CFI
without a usable XPointer, and the plugin does not infer EPUB positions from
page counts produced by another rendering engine. Investigating conversion
problems requires the affected document and client logs.

The iPhone client also applies progress forward-only. Pushing an earlier
position from KOReader does not force an already open iPhone reader backward.
Sibling copies of a book can also be reconciled differently across clients.

Close-time pushes are asynchronous. A process killed before a push finishes
cannot guarantee delivery to the cloud.

## Diagnosing failures

Manual sync failure messages add a short, translated reason on a second line,
such as a timeout, an unreachable network, an authentication failure, or a
server outage. They never show code locations, HTTP codes, internal error
codes, or the text of 5xx server errors. Other readable messages that match no
known reason, such as a 4xx server message ("Permission denied") or an
unrecognized transport error, are shown as received. Automatic sync shows no
message.

Every failed request is logged to `crash.log` with technical detail:
`ReadestSyncClient:<rpc> failed: <detail>` for requests that were sent, or
`ReadestSync: <rpc> failed: <detail>` for failures decided before sending (a
missing token or a failed `token refresh`). Details include the HTTP status,
the server message and Spore's error, but never request headers or tokens.

## Testing

From the repository root, run:

```bash
pnpm test:lua
pnpm lint:lua
```

See [the test harness documentation](../spec/README.md) for LuaJIT, busted, and
SQLite dependencies. Unit tests simulate server responses, concurrent
operations, scheduling, and worker completion.

Device validation should cover:

- Reading on KOReader, closing the book, and opening the same file in Readest.
- Reading in Readest, then opening or resuming the same book in KOReader.
- Manually pulling an earlier position and checking automatic forward-only pulls.
- Disconnecting and reconnecting while progress is pending.
- Syncing after token expiry and after device sleep/wake.
- Closing one book and opening another while requests are in flight.

Actual TLS behavior, worker process cleanup, sleep/wake, and cross-device
position conversion require an emulator or physical-device check. Passing unit
tests alone does not establish that an affected KOReader/iPhone sequence works
on devices.
