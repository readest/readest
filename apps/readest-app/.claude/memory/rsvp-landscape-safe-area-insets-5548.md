---
name: rsvp-landscape-safe-area-insets-5548
description: RSVP overlay clipped by the landscape notch; safe-area padding is one of the few places physical paddingLeft/Right beats the logical properties, and full-screen portals fed per-cell gridInsets still miss an edge in split view
metadata:
  type: project
---

MERGED #5548 (66ade3809). `RSVPOverlay` is `fixed inset-0` but only padded
`gridInsets.top` / `gridInsets.bottom * 0.33`, so in landscape the notch and
rounded corners cut into the header (close, chapter selector, WPM / "Audio
pace") and the transport row. Fix = add `paddingLeft`/`paddingRight` from
`gridInsets` on the overlay root; every child inherits the inset in one place
and the background still paints edge to edge (padding is inside the background
box).

**Safe-area padding is the exception to the RTL logical-property rule.** The
repo standard is never `pl/pr/ml/mr` (see [[feedback_design_system_doc]]), but
the notch sits on a fixed side of the *device*, not of the text flow. Logical
padding would flip it to the wrong physical side for an RTL book. Physical
`paddingLeft`/`paddingRight` is correct wherever the value comes from
`safeAreaInsets` / `gridInsets`.

**Adding padding to a `fixed` ancestor does NOT move its `absolute`
descendants.** An absolutely positioned child resolves against the ancestor's
*padding box*, which for `fixed inset-0` still spans the whole screen. So the
dictionary popup (`Popup` uses `absolute` + `left/top`) kept its placement.
Worth knowing before assuming an overlay's padding will shift its popups.

**UNFIXED gap:** `gridInsets` is *per book cell* (`BooksGrid.perBookGridInsets`
zeroes any edge that does not touch the screen border), but the RSVP overlay is
a full-screen portal. With two books open in landscape the overlay opened from
the left-hand book still has `right: 0` and clips. Same class of bug exists
top/bottom for a bottom-row cell. Real fix = source the overlay's insets from
`themeStore.safeAreaInsets` instead of the cell prop; deferred because it means
unpicking the `gridInsets` prop through `FooterBar` -> `RSVPControl` ->
`RSVPOverlay` and ~14 test call sites. Narrow repro (notched phone, landscape,
two books, RSVP), so it was flagged in the PR body rather than fixed.

Web can't reproduce any of this: `appService.hasSafeAreaInset` is false there,
so every inset is 0 and a notch needs the store patched. See
[[browser-verify-readest-web-recipe]].
