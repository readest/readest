---
name: narration-ios-file-window-6989
description: "#6989 iOS: stored narration audio plays in place via AVAssetResourceLoaderDelegate (MERGED #7019, 2026-10-23); lock-screen resume after suspension UNVERIFIED; Android proxy left in place on purpose"
metadata:
  node_type: memory
  type: project
  originSessionId: 91cc707d-2a99-4d44-a5e7-2f3dcc03470d
  modified: 2026-10-23T11:05:55.044Z
---

#7019 merged 2026-10-23 at f2964f002 (follow-up to #7004 web/desktop, #7010 Android). iOS AVPlayer reads a stored EPUB audio entry's byte window through `FileWindowLoader` (custom scheme + AVAssetResourceLoaderDelegate) in NativeTTSPlugin.swift. The playout `load` action carries start/end/contentType; a rejected window falls back to a staged copy.

- On an iPhone XS Max (4 GB), 0.12.16's staging path got WebContent killed on the 921 MB narr-h16.epub (page reload, no audio). With #7019: first audio 2.9 s, the 8 h seek 4.6 s, no cache copy.
- UNVERIFIED: lock-screen pause, then suspension, then resume from lock-screen controls. The 10-minute position log never caught a lock-screen pause. Real iPad, AAC (.m4a) narration and the reporter's book were not run either.
- The loopback proxy was rejected for iOS: media_proxy.rs binds once per process and never rebinds, and iOS can reclaim a suspended app's listening socket.
- Android keeps the proxy only for remote streaming (ABS `<audio>` + paired ABS/BookOrbit ExoPlayer URLs). The maintainer asked about replacing it; the answer was to defer: an ExoPlayer HTTP DataSource + moving streamed audiobooks to NativeAudiobookClock, in its own PR if wanted.
- The ~4 s before narration starts on every build is the Edge TTS websocket handshake before `get_all_voices`, separate from this.

Test books: ~/Downloads/n6989/ (copied from the Linux box ~/.cache/n6989/epub/). They are also imported into the XS Max library; Books sync was turned off for the test.

Related: [[ios-sim-webview-drive-via-iwdp]], [[ios-worktree-device-build-gotchas]].
