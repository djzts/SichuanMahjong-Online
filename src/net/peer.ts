/** PeerJS transport: the host side (PeerHost) and the client side (PeerClient). */
import Peer, { type DataConnection } from 'peerjs';
import { HEARTBEAT_MS, PEER_PREFIX, PEER_TIMEOUT_MS, peerOptions } from '../config';
import type { Action } from '../engine/game';
import type { Role } from '../engine/room';
import type { ClientView } from '../engine/view';
import type { RoomController } from './controller';
import {
  isClientMsg,
  isHostMsg,
  PROTOCOL_VERSION,
  type ClientMsg,
  type HostMsg,
  type RejectReason,
} from './protocol';

export type HostStatus = 'opening' | 'open' | 'id-taken' | 'signal-lost' | 'error';

interface ConnInfo {
  playerId: string | null;
  lastSeen: number;
}

export class PeerHost {
  status: HostStatus = 'opening';
  detail = '';
  onStatus: (s: HostStatus) => void = () => {};
  private peer: Peer | null = null;
  private conns = new Map<DataConnection, ConnInfo>();
  private byPlayer = new Map<string, DataConnection>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private closed = false;

  constructor(
    private controller: RoomController,
    readonly code: string,
  ) {}

  private setStatus(s: HostStatus, detail = ''): void {
    this.status = s;
    this.detail = detail;
    this.onStatus(s);
  }

  open(): void {
    this.closed = false;
    const peer = new Peer(PEER_PREFIX + this.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => this.setStatus('open'));
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.closed || peer.destroyed) return;
      this.setStatus('signal-lost');
      setTimeout(() => {
        if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect();
      }, 2000);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (this.closed) return;
      if (err.type === 'unavailable-id') this.setStatus('id-taken');
      else if (err.type === 'peer-unavailable') return;
      else if (
        ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type ?? '')
      )
        this.setStatus('signal-lost', err.message);
      else this.setStatus('error', err.message);
    });
    if (!this.unsub) this.unsub = this.controller.subscribe(() => this.broadcast());
    if (!this.heartbeat) this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
  }

  /** Retry opening the same peer ID (used after "ID taken" when a host refreshes). */
  reopen(): void {
    this.peer?.destroy();
    this.open();
  }

  close(): void {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.unsub?.();
    this.unsub = null;
    for (const c of this.conns.keys()) c.close();
    this.conns.clear();
    this.byPlayer.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  private send(conn: DataConnection, msg: HostMsg): void {
    try {
      if (conn.open) void conn.send(msg);
    } catch {
      /* connection is going away; the heartbeat will clean it up */
    }
  }

  private accept(conn: DataConnection): void {
    this.conns.set(conn, { playerId: null, lastSeen: Date.now() });
    conn.on('data', (d) => this.onData(conn, d));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  private reject(conn: DataConnection, reason: RejectReason): void {
    this.send(conn, { t: 'reject', reason });
    setTimeout(() => conn.close(), 500);
    this.conns.delete(conn);
  }

  private onData(conn: DataConnection, data: unknown): void {
    const info = this.conns.get(conn);
    if (!info || !isClientMsg(data)) return;
    info.lastSeen = Date.now();
    const msg = data as ClientMsg;
    switch (msg.t) {
      case 'hello': {
        if (msg.v !== PROTOCOL_VERSION) return this.reject(conn, 'version');
        if (msg.playerId === this.controller.hostId) return this.reject(conn, 'full');
        const name = String(msg.name || '玩家').slice(0, 12);
        const res = this.controller.join({ playerId: msg.playerId, name, role: msg.role });
        if (!res.ok) return this.reject(conn, 'full');
        const old = this.byPlayer.get(msg.playerId);
        if (old && old !== conn) {
          this.conns.delete(old);
          old.close();
        }
        info.playerId = msg.playerId;
        this.byPlayer.set(msg.playerId, conn);
        this.send(conn, { t: 'welcome', role: res.role, seat: res.seat, note: res.note });
        const view = this.controller.viewFor(msg.playerId);
        if (view) this.send(conn, { t: 'state', view });
        break;
      }
      case 'intent': {
        if (!info.playerId) return;
        const res = this.controller.intent(info.playerId, msg.action);
        if (!res.ok) this.send(conn, { t: 'error', message: res.error });
        break;
      }
      case 'switch':
        if (info.playerId) this.controller.switchRole(info.playerId, msg.role);
        break;
      case 'ping':
        break;
    }
  }

  private drop(conn: DataConnection): void {
    const info = this.conns.get(conn);
    this.conns.delete(conn);
    const pid = info?.playerId;
    if (pid && this.byPlayer.get(pid) === conn) {
      this.byPlayer.delete(pid);
      this.controller.disconnect(pid);
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const [conn, info] of [...this.conns]) {
      if (now - info.lastSeen > PEER_TIMEOUT_MS) {
        conn.close();
        this.drop(conn);
      } else {
        this.send(conn, { t: 'ping' });
      }
    }
    // Keep countdowns fresh.
    if (this.controller.room.phase === 'playing') this.broadcast();
  }

  broadcast(): void {
    for (const [pid, conn] of [...this.byPlayer]) {
      const view = this.controller.viewFor(pid);
      if (view) this.send(conn, { t: 'state', view });
      else {
        this.byPlayer.delete(pid);
        this.reject(conn, 'kicked');
      }
    }
  }
}

// ---------------------------------------------------------------------------

export type ClientStatus =
  'connecting' | 'connected' | 'host-lost' | 'not-found' | 'rejected' | 'signal-error';

export class PeerClient {
  view: ClientView | null = null;
  status: ClientStatus = 'connecting';
  rejectReason: RejectReason | null = null;
  lastError = '';
  note = '';
  onChange: () => void = () => {};
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private lastMsg = 0;
  private everConnected = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    readonly code: string,
    private hello: { playerId: string; name: string; role: Role },
  ) {}

  start(): void {
    this.closed = false;
    this.makePeer();
    this.watchdog = setInterval(() => {
      if (this.status === 'connected' && Date.now() - this.lastMsg > PEER_TIMEOUT_MS) {
        this.conn?.close();
        this.lost();
      }
    }, 1000);
  }

  close(): void {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.conn?.close();
    this.peer?.destroy();
  }

  private set(status: ClientStatus): void {
    this.status = status;
    this.onChange();
  }

  private makePeer(): void {
    this.peer?.destroy();
    const peer = new Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (this.closed) return;
      this.lastError = err.message;
      if (err.type === 'peer-unavailable') {
        this.set(this.everConnected ? 'host-lost' : 'not-found');
        this.retry(3000);
      } else if (err.type === 'unavailable-id' || err.type === 'invalid-id') {
        this.retry(1000, true);
      } else {
        this.set(this.everConnected ? 'host-lost' : 'signal-error');
        this.retry(4000, true);
      }
    });
  }

  private retry(ms: number, newPeer = false): void {
    if (this.closed || this.status === 'rejected') return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed) return;
      if (newPeer || !this.peer || this.peer.destroyed) this.makePeer();
      else if (this.peer.disconnected) this.peer.reconnect();
      else this.connect();
    }, ms);
  }

  private connect(): void {
    if (this.closed || !this.peer || this.peer.destroyed) return;
    this.conn?.close();
    const conn = this.peer.connect(PEER_PREFIX + this.code, {
      reliable: true,
      serialization: 'json',
    });
    this.conn = conn;
    conn.on('open', () => {
      this.lastMsg = Date.now();
      this.sendMsg({ t: 'hello', v: PROTOCOL_VERSION, ...this.hello });
    });
    conn.on('data', (d) => this.onData(d));
    conn.on('close', () => {
      if (this.conn === conn) this.lost();
    });
    conn.on('error', () => {
      if (this.conn === conn) this.lost();
    });
  }

  private lost(): void {
    if (this.closed || this.status === 'rejected') return;
    this.conn = null;
    this.set(this.everConnected ? 'host-lost' : 'connecting');
    this.retry(2000);
  }

  private onData(data: unknown): void {
    if (!isHostMsg(data)) return;
    this.lastMsg = Date.now();
    const msg = data as HostMsg;
    switch (msg.t) {
      case 'welcome':
        this.everConnected = true;
        this.hello = { ...this.hello, role: msg.role };
        this.note = msg.note ?? '';
        this.set('connected');
        break;
      case 'state':
        this.view = msg.view;
        if (this.status !== 'connected') this.status = 'connected';
        this.onChange();
        break;
      case 'reject':
        this.rejectReason = msg.reason;
        this.set('rejected');
        this.conn?.close();
        break;
      case 'error':
        this.lastError = msg.message;
        this.onChange();
        break;
      case 'ping':
        this.sendMsg({ t: 'ping' });
        break;
    }
  }

  private sendMsg(msg: ClientMsg): void {
    try {
      if (this.conn?.open) void this.conn.send(msg);
    } catch {
      /* ignore; reconnect logic handles it */
    }
  }

  intent(action: Action): void {
    this.sendMsg({ t: 'intent', action });
  }

  switchRole(role: Role): void {
    this.sendMsg({ t: 'switch', role });
  }
}
