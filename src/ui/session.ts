/**
 * A Session is what the UI talks to. LocalSession runs the room on this device (single-player
 * or as the online host); RemoteSession talks to a host over PeerJS.
 */
import type { Action } from '../engine/game';
import { makeRules, type Rules } from '../engine/rules';
import {
  canSetPlayerCount,
  createRoom,
  fillWithAI,
  type PlayerCount,
  type Role,
  type RoomState,
} from '../engine/room';
import type { ClientView } from '../engine/view';
import { RoomController } from '../net/controller';
import { PeerClient, PeerHost, type HostStatus } from '../net/peer';
import { saveHostRoom } from '../net/storage';

export interface SessionStatus {
  kind: 'ok' | 'connecting' | 'warning' | 'fatal';
  text: string;
}

export interface HostCommands {
  setSeatAI(member: number, ai: boolean): void;
  setPlayerCount(n: PlayerCount): void;
  canSetPlayerCount(n: PlayerCount): boolean;
  kickSpectator(index: number): void;
  start(): void;
  endSession(): void;
}

export interface Session {
  readonly code: string;
  readonly online: boolean;
  readonly host: HostCommands | null;
  view(): ClientView | null;
  status(): SessionStatus;
  intent(action: Action): void;
  switchRole(role: Role): void;
  subscribe(fn: () => void): () => void;
  dispose(): void;
  lastError(): string;
}

export function randomRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class LocalSession implements Session {
  readonly controller: RoomController;
  readonly online: boolean;
  private peerHost: PeerHost | null = null;
  private listeners = new Set<() => void>();
  private error = '';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly host: HostCommands;

  constructor(
    room: RoomState,
    hostId: string,
    opts: { online: boolean; debugAll?: boolean; firstSeed?: number },
  ) {
    this.online = opts.online;
    let seedOnce = opts.firstSeed;
    this.controller = new RoomController(room, hostId, {
      debugAll: opts.debugAll,
      seed:
        seedOnce === undefined
          ? undefined
          : () => {
              const s = seedOnce ?? Math.floor(Math.random() * 2 ** 32);
              seedOnce = undefined;
              return s;
            },
    });
    this.controller.subscribe(() => {
      this.emit();
      if (this.online) this.persist();
    });
    if (this.online) {
      this.peerHost = new PeerHost(this.controller, room.code);
      this.peerHost.onStatus = (s) => {
        if (s === 'id-taken') setTimeout(() => this.peerHost?.reopen(), 3000);
        this.emit();
      };
      this.peerHost.open();
      this.persist();
    }
    const c = this.controller;
    this.host = {
      setSeatAI: (member, ai) => c.setSeatAI(member, ai),
      setPlayerCount: (n) => c.setPlayerCount(n),
      canSetPlayerCount: (n) => canSetPlayerCount(c.room, n),
      kickSpectator: (index) => {
        const sp = c.room.spectators[index];
        if (sp) c.kickSpectator(sp.playerId);
      },
      start: () => {
        c.start();
      },
      endSession: () => c.endSession(),
    };
  }

  static solo(
    name: string,
    hostId: string,
    opts: { debug?: boolean; seed?: number; rules?: Rules; playerCount?: PlayerCount },
  ) {
    const room = fillWithAI(
      createRoom(
        'solo',
        opts.rules ?? makeRules(),
        { playerId: hostId, name },
        opts.playerCount ?? 4,
      ),
    );
    const s = new LocalSession(room, hostId, {
      online: false,
      debugAll: opts.debug,
      firstSeed: opts.seed,
    });
    s.controller.start();
    return s;
  }

  get code(): string {
    return this.controller.room.code;
  }

  private persist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveHostRoom(this.controller.room);
    }, 300);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  view(): ClientView | null {
    return this.controller.viewFor(this.controller.hostId);
  }

  status(): SessionStatus {
    if (!this.peerHost) return { kind: 'ok', text: '' };
    const s: HostStatus = this.peerHost.status;
    switch (s) {
      case 'open':
        return { kind: 'ok', text: '' };
      case 'opening':
        return { kind: 'connecting', text: '正在连接信令服务器…' };
      case 'id-taken':
        return { kind: 'warning', text: '房间号暂时被占用（刚刷新过？），正在重试…' };
      case 'signal-lost':
        return { kind: 'warning', text: '与信令服务器断开，正在重连（已连上的玩家不受影响）…' };
      default:
        return { kind: 'warning', text: `联网出错：${this.peerHost.detail}` };
    }
  }

  intent(action: Action): void {
    const res = this.controller.intent(this.controller.hostId, action);
    this.error = res.ok ? '' : res.error;
  }

  switchRole(): void {
    /* the host always keeps seat 0 */
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      saveHostRoom(this.controller.room);
    }
    this.peerHost?.close();
    this.controller.dispose();
    this.listeners.clear();
  }

  lastError(): string {
    return this.error;
  }
}

export class RemoteSession implements Session {
  readonly online = true;
  readonly host = null;
  private client: PeerClient;
  private listeners = new Set<() => void>();

  constructor(
    readonly code: string,
    hello: { playerId: string; name: string; role: Role },
  ) {
    this.client = new PeerClient(code, hello);
    this.client.onChange = () => {
      for (const fn of this.listeners) fn();
    };
    this.client.start();
  }

  view(): ClientView | null {
    return this.client.view;
  }

  status(): SessionStatus {
    switch (this.client.status) {
      case 'connected':
        return {
          kind: 'ok',
          text: this.client.note === 'seats-full' ? '座位已满，已进入观战' : '',
        };
      case 'connecting':
        return { kind: 'connecting', text: '正在连接房主…' };
      case 'not-found':
        return { kind: 'connecting', text: '找不到这个房间（房主还没开房或已离线），正在重试…' };
      case 'host-lost':
        return { kind: 'warning', text: '房主已断开，游戏暂停，正在重连…' };
      case 'signal-error':
        return {
          kind: 'connecting',
          text: `连接信令服务器失败，正在重试… ${this.client.lastError}`,
        };
      case 'rejected': {
        const r = this.client.rejectReason;
        const text =
          r === 'full'
            ? '房间已满'
            : r === 'version'
              ? '版本不一致，请刷新页面后再试'
              : '你已被房主移出房间';
        return { kind: 'fatal', text };
      }
    }
  }

  intent(action: Action): void {
    this.client.intent(action);
  }

  switchRole(role: Role): void {
    this.client.switchRole(role);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.client.close();
    this.listeners.clear();
  }

  lastError(): string {
    return this.client.lastError;
  }
}
