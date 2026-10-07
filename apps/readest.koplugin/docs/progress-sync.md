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
An explicit manual pull can move to an earlier position. If the saved position
cannot be used in the current document, the plugin reports that limitation
instead of reporting successful synchronization.

Pushes retain the identity and settings of the book they were created for.
Opening another book while a push is running does not redirect its completion
metadata to the new book.

## Authentication and request handling

Sync operations wait for an expired access token to refresh before sending
requests. Concurrent operations share one refresh. If a request rejects an
access token, the plugin refreshes and retries once, or uses a token already
refreshed by another request. Refresh results from an old session are ignored
after logout or a new login.

Transient refresh failures preserve the session. Rejected refresh tokens
require a new login. Refreshed tokens are flushed to disk so they survive an
unclean exit.

HTTP requests and token refreshes have deadlines. Without Turbo, refreshes use
a background worker to avoid blocking reader input. A request completes at
most once, even when its callback arrives after the deadline.

Read RPCs retry transient timeouts once. Automatic progress pushes have one
delayed retry, and failed progress is retained for reconnect. Writes are not
indiscriminately replayed after ambiguous transport errors. Wi-Fi connectivity
alone does not guarantee success: DNS, TLS, rate limits, service outages, and
database errors can still prevent synchronization.

## Position identity and conflict handling

Progress pushes resolve the library's book identity before constructing the
payload, including when a local PDF metadata hash differs from the library's
stamped hash. Documents without a checksum cannot be identified for sync.

The server merges configuration using timestamps. The plugin persists an
observed monotonic configuration clock to handle local clock skew and pushes
within the same second. If the server retains an older position because of a
timestamp conflict, the latest push for that book can retry once with a newer
timestamp. An older push cannot use a conflict retry to overwrite a newer one.
Moving the local clock backward also resets the push debounce and allows
resume sync to proceed.

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
