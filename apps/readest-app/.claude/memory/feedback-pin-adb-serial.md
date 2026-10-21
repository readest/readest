---
name: feedback-pin-adb-serial
description: Pin ANDROID_SERIAL / adb -s for every device action; chrox swaps USB devices mid-session
metadata:
  node_type: memory
  type: feedback
  originSessionId: cb51df53-15ef-424f-9bd4-07f9f549b5d5
  modified: 2026-10-10T05:29:26.842Z
---

Always pin the target device (`export ANDROID_SERIAL=<serial>` or `adb -s <serial>`) for installs,
force-stops and device test runs, and re-check `adb devices -l` (model) right before `adb install`.

**Why:** 2026-10-10 the Leaf5 (ec8fafd) was swapped for chrox's Xiaomi phone during a 7-minute APK
build; an unpinned `adb install -r` + e2e run then replaced Readest on the phone with a test build and
imported a fixture book there. The user also tests by hand on the same device, so automated runs that
force-stop the app collide with them.

**How to apply:** record the serial when the user names a device; abort if the model changes. Restore
any device setting you changed (e.g. `accelerometer_rotation`) before handing the device back.
See [[boox-pen-sdk-build-gotchas]].
