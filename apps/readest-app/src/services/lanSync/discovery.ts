import { invoke } from '@tauri-apps/api/core';

/** A Readest peer advertised on the current local network. */
export interface DiscoveredLanPeer {
  name: string;
  host: string;
  port: number;
  device_id: string;
  /** Empty because pairing tokens are exchanged out-of-band. */
  token: string;
}

/**
 * Browse the Readest mDNS service for a short, bounded window. The Rust side
 * performs the blocking mDNS wait off the UI runtime and returns only IPv4
 * peers with the service metadata needed to fill the connection form.
 */
export const discoverLanPeers = async (): Promise<DiscoveredLanPeer[]> =>
  invoke<DiscoveredLanPeer[]>('lan_sync_discover');
