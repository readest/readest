---
name: webdav-sync-fixes
description: "Aggregator of WebDAV sync bug-fix memories (metadata LWW, groups, credentials, connect, serverUrl)"
metadata: 
  node_type: memory
  type: project
  originSessionId: b616ba37-dbf6-48e5-95b9-34fd2c642626
---

- [[webdav-metadata-sync-4756]] — metadata LWW #4756
- [[webdav-group-membership-sync-4942]] — group membership sync #4942
- [[webdav-credential-sync-4810]] — credential sync #4810
- [[webdav-connect-nullified-4780]] — connect nullified by stale settings closure #4780
- [[webdav-serverurl-stranded-5141]] — serverUrl stranded #5141; seeded-snapshot vs push-hash asymmetry; eink checkbox border
- Related invariant: [[webdav-deletion-and-upload-after-enable-4860-4856]] — edit-wins LWW + tombstone union
