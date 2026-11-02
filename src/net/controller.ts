/**
 * RoomController runs on the host. It owns the room state and drives everything that needs a
 * clock: turn timers, AI moves (for AI seats and disconnected players), and hand transitions.
 * It knows nothing about the network; PeerHost and the single-player session plug into it.
 */
import { aiDecide } from '../engine/ai';
import { pendingSeats, timeoutAction, type Action } from '../engine/game';
import { randomSeed } from '../engine/rng';
import {
  applyRoomAction,
  canStart,
  endSession,
  findMember,
  findSpectator,
  joinRoom,
  removeSpectator,
  seatOfMember,
  setConnected,
  setPlayerCount,
  setSeatAI,
  startHand,
  switchRole,
  type PlayerCount,
  type Role,
  type RoomState,
} from '../engine/room';
import { gameViewFor, viewFor, type ClientView } from '../engine/view';

export interface ControllerOptions {
  aiDelayMs?: [number, number];
  seed?: () => number;
  /** Single-player debug: the host sees every hand. */
  debugAll?: boolean;
}

export type JoinOutcome =
  { ok: true; role: Role; member: number | null; note?: string } | { ok: false; reason: string };

type Listener = () => void;

export class RoomController {
  room: RoomState;
  readonly hostId: string;
  private listeners = new Set<Listener>();
  private aiTimers: ReturnType<typeof setTimeout>[] = [];
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineAt: number | null = null;
  private stepKey: string | null = null;
  private opts: Required<ControllerOptions>;
  private disposed = false;

  constructor(room: RoomState, hostId: string, opts: ControllerOptions = {}) {
    this.room = room;
    this.hostId = hostId;
    this.opts = {
      aiDelayMs: opts.aiDelayMs ?? [500, 1500],
      seed: opts.seed ?? randomSeed,
      debugAll: opts.debugAll ?? false,
    };
    this.schedule();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
  }

  private update(room: RoomState): void {
    if (room === this.room) return;
    this.room = room;
    this.schedule();
    for (const fn of this.listeners) fn();
  }

  // -------------------------------------------------------------------------
  // Clients

  join(who: { playerId: string; name: string; role: Role }): JoinOutcome {
    const res = joinRoom(this.room, who);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.update(res.room);
    return {
      ok: true,
      role: res.role,
      member: res.role === 'player' ? res.member : null,
      note: res.note,
    };
  }

  disconnect(playerId: string): void {
    if (playerId === this.hostId) return;
    this.update(setConnected(this.room, playerId, false));
  }

  intent(playerId: string, action: Action): { ok: true } | { ok: false; error: string } {
    const member = findMember(this.room, playerId);
    if (member < 0) return { ok: false, error: 'spectators cannot act' };
    const seat = seatOfMember(this.room, member);
    if (this.room.phase !== 'playing' || seat < 0)
      return { ok: false, error: 'not playing this hand' };
    const res = applyRoomAction(this.room, seat, action);
    if (!res.ok) return res;
    this.update(res.room);
    return { ok: true };
  }

  viewFor(playerId: string): ClientView | null {
    const remaining = this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - Date.now());
    const member = findMember(this.room, playerId);
    if (member >= 0)
      return viewFor(
        this.room,
        { kind: 'member', member, debugAll: this.opts.debugAll && playerId === this.hostId },
        remaining,
      );
    if (findSpectator(this.room, playerId) >= 0)
      return viewFor(this.room, { kind: 'spectator' }, remaining);
    return null;
  }

  // -------------------------------------------------------------------------
  // Lobby / session commands (host only — callers must enforce that)

  setSeatAI(member: number, ai: boolean): void {
    this.update(setSeatAI(this.room, member, ai));
  }

  setPlayerCount(n: PlayerCount): void {
    this.update(setPlayerCount(this.room, n));
  }

  switchRole(playerId: string, role: Role): void {
    this.update(switchRole(this.room, playerId, role));
  }

  kickSpectator(playerId: string): void {
    this.update(removeSpectator(this.room, playerId));
  }

  start(): boolean {
    if (!canStart(this.room)) return false;
    this.update(startHand(this.room, this.opts.seed()));
    return true;
  }

  endSession(): void {
    this.update(endSession(this.room));
  }

  // -------------------------------------------------------------------------
  // Timers and AI

  private clearTimers(): void {
    for (const t of this.aiTimers) clearTimeout(t);
    this.aiTimers = [];
  }

  private clearDeadline(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    this.deadlineAt = null;
  }

  private isAutoSeat(seat: number): boolean {
    const s = this.room.members[this.room.table[seat]];
    return !!s && (s.kind === 'ai' || !s.connected);
  }

  private schedule(): void {
    if (this.disposed) return;
    this.clearTimers();
    const game = this.room.game;
    if (this.room.phase !== 'playing' || !game) {
      this.clearDeadline();
      this.stepKey = null;
      return;
    }
    const step = game.step;
    const key = `${this.room.handNo}:${step.kind}:${game.eventSeq}:${step.kind === 'act' ? step.seat : ''}`;
    const pending = pendingSeats(game);

    for (const seat of pending) {
      if (!this.isAutoSeat(seat)) continue;
      const [lo, hi] = this.opts.aiDelayMs;
      const delay = lo + Math.random() * (hi - lo);
      this.aiTimers.push(setTimeout(() => this.runAI(seat), delay));
    }

    const timers = this.room.rules.timers;
    const humanPending = pending.some((s) => !this.isAutoSeat(s));
    if (!timers.enabled || !humanPending) {
      this.clearDeadline();
      this.stepKey = key;
      return;
    }
    if (key === this.stepKey && this.deadlineTimer) return; // same step: keep the clock running
    this.stepKey = key;
    this.clearDeadline();
    const sec =
      step.kind === 'exchange'
        ? timers.exchangeSec
        : step.kind === 'void'
          ? timers.voidSec
          : step.kind === 'act'
            ? timers.turnSec
            : timers.claimSec;
    this.deadlineAt = Date.now() + sec * 1000;
    this.deadlineTimer = setTimeout(() => this.onDeadline(), sec * 1000);
  }

  private runAI(seat: number): void {
    if (this.disposed || this.room.phase !== 'playing') return;
    if (!pendingSeats(this.room.game!).includes(seat)) return;
    const view = gameViewFor(this.room.game!, { kind: 'player', seat });
    const action = aiDecide(view);
    if (!action) return;
    const res = applyRoomAction(this.room, seat, action);
    if (res.ok) this.update(res.room);
  }

  private onDeadline(): void {
    this.deadlineTimer = null;
    this.deadlineAt = null;
    if (this.disposed || this.room.phase !== 'playing') return;
    let room = this.room;
    for (const seat of pendingSeats(room.game!)) {
      if (this.isAutoSeat(seat) || room.phase !== 'playing') continue;
      if (!pendingSeats(room.game!).includes(seat)) continue;
      const action = timeoutAction(room.game!, seat);
      if (!action) continue;
      const res = applyRoomAction(room, seat, action);
      if (res.ok) room = res.room;
    }
    this.stepKey = null;
    if (room !== this.room) this.update(room);
    else this.schedule();
  }
}
