/**
 * Deployment configuration.
 *
 * NOTE: this is a static site — anything here (including TURN credentials) is public.
 * Use TURN credentials that are restricted / short-lived, or a TURN service you trust.
 */
import type { PeerOptions } from 'peerjs';

/** Prefix for PeerJS IDs so rooms don't collide with other apps on the public server. */
export const PEER_PREFIX = 'scmj-';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Add a TURN server if some players cannot connect (strict NAT / mobile networks), e.g.:
  // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
  // { urls: 'turns:turn.example.com:5349', username: 'user', credential: 'pass' },
];

/**
 * PeerJS signaling server. Leave host undefined to use the free PeerJS cloud server
 * (0.peerjs.com). For a self-hosted peerjs-server set host/port/path/secure.
 */
export const PEER_SERVER: Pick<PeerOptions, 'host' | 'port' | 'path' | 'secure' | 'key'> = {
  // host: 'peer.example.com',
  // port: 443,
  // path: '/',
  // secure: true,
};

export function peerOptions(): PeerOptions {
  return {
    ...PEER_SERVER,
    debug: 1,
    config: { iceServers: ICE_SERVERS },
  };
}

/** Heartbeat: the host pings every client; silence longer than this counts as a disconnect. */
export const HEARTBEAT_MS = 4000;
export const PEER_TIMEOUT_MS = 13000;
