# Bookshelves

Open **View → Bookshelves** to configure stacked library sections in a full-screen window
on desktop and mobile. Each shelf has a **Carousel layout** switch, filters, primary and secondary sorts,
and directions. With Carousel off, the shelf follows the View menu’s Grid/List setting and includes
every result. Carousel starts on for new shelves and off for Default. All layouts include
every matching result after exclusions. Carousels render only a moving window of cards with a
small buffer and lazy-loaded covers, so no book limit is needed. Old saved limits are ignored.
Predefined shelves start in this order: Recently read, Audiobooks, Podcasts, Default, Finished books.
They can be renamed, reordered or disabled, but cannot be deleted. Audiobooks and Podcasts start
enabled with Carousel on, Crop covers, global grouping/sorting and Exclusive on. Audiobooks
matches Audiobook Is Yes; Podcasts matches Media type Is Podcast. Finished books starts after
Default, disabled with Carousel and Exclusive on, and filters for finished reading status.
Predefined positions are stable: new presets use gaps in `BUILTIN_BOOKSHELF_POSITIONS` without
renumbering existing entries. This preserves manual ordering and saved custom shelf positions.
Default has no heading on the library page; its name remains visible in the editor and preview.
Empty shelves are hidden in the library but remain available in Manage Bookshelves and its preview.
Inset horizontal dividers separate visible shelves, including Default.
Import follows the last visible shelf: a book-sized plus tile continues a grid, a full row
continues a list, and a centered button below a carousel reuses the empty-library action,
capped at 320px wide with the neutral Import Font styling and circular plus badge.
The empty library keeps its primary-colored action. Import remains available when all shelves are empty.
Disabled shelves and the global view mode do not override a carousel's
import action; search and opened groups use their displayed layout.
Tabs show every name while they fit on one line. When space runs out, inactive tabs collapse
to icons with name tooltips while the selected tab keeps its name. The circular plus button adds
a shelf. Each predefined shelf has its own icon.
Drag the shelf tabs to reorder them (long press on touchscreens), or focus a tab and use
Alt + Left/Right. Reordering updates exclusive ownership in the draft preview immediately;
an enabled, exclusive Finished books shelf retains priority regardless of position.
Rename a shelf directly in its tab using the pencil button, a double click, or F2. Enter or
clicking outside accepts the name; Escape cancels the rename. **+ Add** inserts a shelf
immediately after Recently read, named New bookshelf 1, New bookshelf 2, and so on, avoiding names
already in use. The red **Delete** action at the bottom right of the settings pane asks
for confirmation. Confirmed deletion is saved automatically; books remain in the library. **Reset**
asks for confirmation, then keeps the shelf's name and position. For a custom shelf it keeps the
filters and the Exclusive / Include options and resets layout, covers, grouping and sorting; a
predefined shelf is restored to its built-in definition. It keeps the last enabled shelf enabled.
Use each shelf's **Enabled** and **Hide covers** switches to control its visibility and cover
art. **Book covers**, below Hide covers, chooses Crop or Fit independently for each shelf and its
preview, including grouped covers. On upgrade, a one-time migration saves the old Recently read
visibility, Hide covers, Crop/Fit and Skeuomorphic covers preferences into unconfigured predefined
shelves. It preserves existing shelf definitions and order. Later changes to the legacy settings
do not reset migrated shelves; new custom shelves start with visible covers and Crop.
**Skeuomorphic covers**, below Book covers, adds a spine effect independently for each shelf and
its preview. Existing shelves retain the previous Theme setting; new shelves start with it off.
Covers outside any shelf (book details, the full-screen cover viewer, the reader sidebar) follow the
Default shelf's Hide covers and Skeuomorphic covers, which Manage Bookshelves can still change.
View-menu Grid/List changes every non-carousel shelf without changing shelf definitions. Carousel
shelves keep their layout. Search always uses the chosen Grid/List mode.

The **Grouping** box above Sorting starts with **Use global grouping**, enabled by default.
Its disabled **Group by** selector shows the View menu’s choice. Turn off the switch to choose
Authors, Books, Groups, Series, Tags, Subjects or Status for this shelf. Switching inheritance
back on retains that individual choice. Preview and library share the same grouping, including
carousels. Opening a group from a shelf retains that shelf’s filters and exclusions. A group opened
without a shelf, from a tag or subject in book details or from an older link, shows every library
book in that group.

The **Sorting** box starts with **Use global sorting**, enabled by default for every shelf,
including older saved definitions. These shelves follow the View menu’s primary and secondary
sorts, directions, and grouping-based smart defaults. The four individual controls show the
inherited values and remain disabled. Turn off the switch to use the shelf’s own sorting;
switching it back on retains those individual choices for later. View-menu sorting changes
never rewrite shelf definitions. Preview and library use the same resolved sorting, and global
search always follows the View menu.
New shelves and Reset use Date Read descending, no secondary sort, and secondary ascending
enabled as their individual sorting defaults.

Filters use nested All (AND) and Any (OR) groups. An empty root matches all books. Incomplete
conditions and empty nested groups cannot be saved. A shelf definition is limited to 60,000 bytes
serialized; a larger one fails validation in the editor. **Is not** and **Does not contain** also
match books that lack the field. **Is not set** matches missing values; other comparisons require a
value. The field registry in
`src/services/bookshelves/fields.ts` is shared by the editor, validator and evaluator. Calibre
column rules keep their column label and type even when that column is absent on a device.
Date Read retains the previous library meaning (`updatedAt`, including metadata/status edits).
Date conditions support **Within the last** followed by a positive whole number and **Days**,
**Months** or **Years**. The interval is relative to today, includes the boundary date and today,
and excludes future dates. Like other date comparisons, it uses UTC calendar days; months and
years clamp to the last valid day for month-end and leap-year boundaries. Library and preview
refresh these ranges at midnight and when the app regains focus. The saved filter retains the
interval, so it stays relative after syncing or restoring a backup.

Exclusive shelves claim **all** matching books before sorting or grouping.
An enabled, exclusive **Finished books** shelf owns its matching books first, regardless of
its name or display position. Other exclusive shelves claim remaining matches in display order.
Shelves exclude books owned elsewhere unless **Include books from exclusive shelves** is enabled.
For example, marking an audiobook finished moves it from an exclusive Audiobooks shelf into
an exclusive Finished books shelf without adding a status condition to Audiobooks.
Disabled shelves claim nothing; turning off Exclusive on Finished books removes its priority.
Recently read includes books from exclusive shelves by default, keeping its matching recent
books visible regardless of which shelf owns them. This option can still be turned off.
An exclusive shelf must have a complete nonempty filter. Ownership changes no book metadata.

The embedded preview evaluates the complete draft and temporarily enables the selected shelf
if disabled. It uses the library's evaluator, grouping, cards and stream, with card interactions
inert. Books render at half scale using twice the preview's visible width, with responsive
columns and no horizontal scrollbar. Wide screens show controls and preview in equal columns;
narrow screens keep the preview below the controls. Both panes scroll independently, keeping the
tabs stationary. Valid changes save automatically after a short pause, applying only edited
definitions, deletions and moves to the latest configuration. The header briefly shows Saving…
and Saved; incomplete inputs show a validation hint and keep the last valid configuration saved.
Valid shelves keep autosaving while another shelf has an incomplete condition.
Closing the window finishes pending valid changes. Failed saves offer Retry and keep the window
open. Tabs stay centered on every line as they wrap, with status information on its own line on
mobile and beside the tabs on wider screens. Reopening Manage Bookshelves selects the last used
shelf, falling back to the first shelf if it was deleted. The Info button beside Match explains conditions, AND/OR matching and nested
filter groups. Global search ignores shelf filters and ownership.

The library has one vertical Virtuoso stream. Grid rows use the responsive/fixed column settings;
carousels maintain bounded horizontal windows. Selection is shared by book hash, and Select all
expands groups and deduplicates the books represented by the displayed sections.
Carousels use smooth scrolling on normal screens. Edge arrows appear when hovering over that
carousel or focusing an arrow with the keyboard. Previous/Next page buttons appear only in e-ink mode.
In e-ink mode, the library also has fixed Previous/Next controls for its vertical stream, including
grid and list shelves. These move instantly by visible rows, keeping a shelf heading with its first
row and repeating partly visible rows on the next page. Page Up/Down and configured hardware
page-turn buttons work here too; editing fields and open dialogs or menus keep their own input.

## Persistence and rollout

Apply `docker/volumes/db/migrations/023_replica_bookshelf.sql` **before deploying the web/API**, and
deploy both **before releasing clients**. The API allowlist ships with the app, so a client can push
this kind as soon as the API accepts it: without the migration the insert fails the database CHECK
and the push returns 500. The migration expands the database allowlist without changing existing
replicas. Older servers reject this kind with `UNKNOWN_KIND`; the existing sync manager isolates
that kind so unrelated sync continues. Pending bookshelf operations remain durable for retry.

Each shelf is one metadata-only `bookshelf` replica. Its `definition` is one atomic LWW field;
`position` is stamped separately. Built-ins use `recent` / `audiobooks` / `podcasts` / `default` /
`finished`, custom shelves use UUIDs, and position ties resolve by stable ID. Custom deletion is remove-wins and cannot be reversed
by a stale editor. If concurrent disables leave no enabled shelf, Default is effectively enabled
locally without publishing a repair.

Converged rows live in `SystemSettings.bookshelves`, included in backups and merged across desktop
windows. The per-device localStorage journal retains original operation timestamps and account
identity until the exact field versions are acknowledged. It merges repeated edits into one pending
record per shelf. A custom shelf created anonymously and deleted before publication is removed
from both the journal and local state when its local creation history proves it was never published.
Published shelves and older records without that proof retain deletion markers to prevent stale
devices from restoring them. Backups omit device-local creation markers.
Anonymous edits bind to the first account that syncs them; edits belonging to another account are
never published under the current account. Reading settings recovers anonymous edits and the cached account's interrupted journal
writes without refreshing an expired token; other accounts' pending edits remain in the journal.
Remote application merges with newer local rows. Migration defaults are saved locally with baseline
timestamps, so synced user edits take precedence. The completion marker is saved with the config and retained by merges;
untouched migrated defaults are not queued as user edits.
The journal keeps each field's original stamp, so last-writer-wins follows edit time. The row-level
`updated_at_ts`, and a tombstone's `deleted_at_ts`, is restamped when the row is actually pushed:
the server rejects row stamps more than 60 seconds from its clock, and pull cursors key on that
stamp. Uploads use batches of at most 100 records; successful batches are acknowledged while failed
records and newer edits remain pending. A row the server permanently rejects is isolated so it
cannot block other rows or kinds.
Restoring a backup merges shelf rows by their stamps: it adds shelves missing locally and never
rolls back newer local shelf edits.
The wire schemas are strict. A row written by a newer client, with an unknown field or an unknown
property inside the definition, is dropped whole by older clients, and that shelf falls back to its
previous or default definition; the full pull at the next app start after upgrading fetches it
again. Adding a field therefore needs the server validator deployed first.
Bookshelf replicas follow **App settings** account sync and have no file-provider representation.

## Verification

- `pnpm test --run src/__tests__/bookshelves`
- `pnpm test:browser src/__tests__/bookshelves`
- `pnpm test --run --maxWorkers=4`
- `pnpm lint`
- `pnpm format:check`

Chromium tests cover mobile/desktop editor layouts, RTL, e-ink borders, a 6,000-book mixed library,
a 10,000-book carousel, and one vertical scroller. Editor screenshots are written under `.next/`.
