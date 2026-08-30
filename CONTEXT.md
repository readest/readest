# Readest LAN Sync Context

This context defines the user-facing language for connecting Readest devices directly over a shared local network.

## Language

**LAN Sync**:
Peer-to-peer synchronization between Readest devices on the same local network.
_Avoid_: cloud sync, remote sync

**Peer**:
The other Readest device participating in a LAN Sync connection.
_Avoid_: server, client (when describing the relationship)

**Pairing token**:
An optional shared secret that restricts LAN Sync access when direct anonymous access is not desired.
_Avoid_: password, API key

**Pairing QR code**:
A scannable representation of a Readest LAN Sync connection's peer address, port, and optional pairing token.
_Avoid_: QR link (the payload is connection data, not a general web link)
