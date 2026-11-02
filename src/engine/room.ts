/**
 * Room / session state: seats, spectators, running totals and the current hand.
 * Pure functions only — timers, AI scheduling and networking live in the controller.
 */
import {
  applyAction,
  createGame,
  handDeltas,
  type Action,
  type ActionResult,
  type GameState,
} from './game';
import type { Rules } from './rules';

export type SeatKind = 'human' | 'ai';

export interface SeatInfo {
  kind: SeatKind;
  playerId: string | null;
  name: string;
  connected: boolean;
}

export interface SpectatorInfo {
  playerId: string;
  name: string;
  connected: boolean;
}

export interface HandRecord {
  handNo: number;
  dealer: number;
  deltas: number[];
  winners: number[];
  reason: 'three-won' | 'wall-exhausted';
}

export type RoomPhase = 'lobby' | 'playing' | 'handEnd' | 'finished';

export interface RoomState {
  code: string;
  rules: Rules;
  /** Seat 0 is always the host. `null` = empty seat. */
  seats: (SeatInfo | null)[];
  spectators: SpectatorInfo[];
  phase: RoomPhase;
  handNo: number;
  dealer: number;
  totals: number[];
  history: HandRecord[];
  game: GameState | null;
}

export type Role = 'player' | 'spectator';

export type JoinResult =
  | { ok: true; room: RoomState; role: 'player'; seat: number; note?: 'seats-full' }
  | { ok: true; room: RoomState; role: 'spectator'; note?: 'seats-full' }
  | { ok: false; reason: 'full' };

const AI_NAMES = ['电脑·小熊猫', '电脑·火锅', '电脑·川妹子'];

function copyRoom(room: RoomState): RoomState {
  return {
    ...room,
    seats: room.seats.map((s) => (s ? { ...s } : null)),
    spectators: room.spectators.map((s) => ({ ...s })),
    totals: [...room.totals],
    history: [...room.history],
  };
}

export function createRoom(
  code: string,
  rules: Rules,
  host: { playerId: string; name: string },
): RoomState {
  return {
    code,
    rules,
    seats: [
      { kind: 'human', playerId: host.playerId, name: host.name, connected: true },
      null,
      null,
      null,
    ],
    spectators: [],
    phase: 'lobby',
    handNo: 0,
    dealer: 0,
    totals: [0, 0, 0, 0],
    history: [],
    game: null,
  };
}

export function findSeat(room: RoomState, playerId: string): number {
  return room.seats.findIndex((s) => s?.kind === 'human' && s.playerId === playerId);
}

export function findSpectator(room: RoomState, playerId: string): number {
  return room.spectators.findIndex((s) => s.playerId === playerId);
}

/**
 * Seat a joining client. Known playerIds go back to where they were. During a game a
 * disconnected human seat with the same nickname can be reclaimed (fallback match).
 */
export function joinRoom(
  input: RoomState,
  who: { playerId: string; name: string; role: Role },
): JoinResult {
  const room = copyRoom(input);
  const seat = findSeat(room, who.playerId);
  if (seat >= 0) {
    room.seats[seat]!.connected = true;
    room.seats[seat]!.name = who.name || room.seats[seat]!.name;
    return { ok: true, room, role: 'player', seat };
  }
  const spec = findSpectator(room, who.playerId);
  if (spec >= 0) {
    room.spectators[spec].connected = true;
    return { ok: true, room, role: 'spectator' };
  }
  let note: 'seats-full' | undefined;
  if (who.role === 'player') {
    if (room.phase === 'lobby') {
      const free = room.seats.findIndex((s) => s === null);
      if (free >= 0) {
        room.seats[free] = {
          kind: 'human',
          playerId: who.playerId,
          name: who.name,
          connected: true,
        };
        return { ok: true, room, role: 'player', seat: free };
      }
    } else {
      const byName = room.seats.findIndex(
        (s) => s?.kind === 'human' && !s.connected && s.name === who.name,
      );
      if (byName >= 0) {
        room.seats[byName] = { ...room.seats[byName]!, playerId: who.playerId, connected: true };
        return { ok: true, room, role: 'player', seat: byName };
      }
    }
    note = 'seats-full';
  }
  const connected = room.spectators.filter((s) => s.connected).length;
  if (room.spectators.length >= room.rules.spectator.slots) {
    // Drop a disconnected spectator to make room, if any.
    const idx = room.spectators.findIndex((s) => !s.connected);
    if (idx < 0 || connected >= room.rules.spectator.slots) return { ok: false, reason: 'full' };
    room.spectators.splice(idx, 1);
  }
  room.spectators.push({ playerId: who.playerId, name: who.name, connected: true });
  return { ok: true, room, role: 'spectator', note };
}

export function setConnected(input: RoomState, playerId: string, connected: boolean): RoomState {
  const room = copyRoom(input);
  const seat = findSeat(room, playerId);
  if (seat >= 0) {
    if (room.phase === 'lobby' && !connected && seat !== 0) room.seats[seat] = null;
    else room.seats[seat]!.connected = connected;
  }
  const spec = findSpectator(room, playerId);
  if (spec >= 0) {
    if (room.phase === 'lobby' && !connected) room.spectators.splice(spec, 1);
    else room.spectators[spec].connected = connected;
  }
  return room;
}

export function setSeatAI(input: RoomState, seat: number, ai: boolean): RoomState {
  if (input.phase !== 'lobby' || seat === 0) return input;
  const room = copyRoom(input);
  const cur = room.seats[seat];
  if (ai && cur === null) {
    const used = new Set(room.seats.map((s) => s?.name));
    const name = AI_NAMES.find((n) => !used.has(n)) ?? `电脑${seat}`;
    room.seats[seat] = { kind: 'ai', playerId: null, name, connected: true };
  } else if (!ai && cur?.kind === 'ai') {
    room.seats[seat] = null;
  }
  return room;
}

export function fillWithAI(input: RoomState): RoomState {
  let room = input;
  for (let s = 1; s < 4; s++) if (room.seats[s] === null) room = setSeatAI(room, s, true);
  return room;
}

/** Lobby only: move a client between a player seat and a spectator slot. */
export function switchRole(input: RoomState, playerId: string, role: Role): RoomState {
  if (input.phase !== 'lobby') return input;
  const seat = findSeat(input, playerId);
  const spec = findSpectator(input, playerId);
  if (role === 'spectator' && seat > 0) {
    if (input.spectators.length >= input.rules.spectator.slots) return input;
    const room = copyRoom(input);
    const info = room.seats[seat]!;
    room.seats[seat] = null;
    room.spectators.push({ playerId, name: info.name, connected: true });
    return room;
  }
  if (role === 'player' && spec >= 0) {
    const free = input.seats.findIndex((s) => s === null);
    if (free < 0) return input;
    const room = copyRoom(input);
    const info = room.spectators.splice(spec, 1)[0];
    room.seats[free] = { kind: 'human', playerId, name: info.name, connected: true };
    return room;
  }
  return input;
}

export function removeSpectator(input: RoomState, playerId: string): RoomState {
  const room = copyRoom(input);
  room.spectators = room.spectators.filter((s) => s.playerId !== playerId);
  return room;
}

export function canStart(room: RoomState): boolean {
  return (
    (room.phase === 'lobby' || room.phase === 'handEnd') && room.seats.every((s) => s !== null)
  );
}

export function startHand(input: RoomState, seed: number): RoomState {
  if (!canStart(input)) return input;
  const room = copyRoom(input);
  room.handNo++;
  room.phase = 'playing';
  room.game = createGame({ rules: room.rules, seed, dealer: room.dealer });
  return room;
}

/** Who deals next: first winner; the discarder after a multi-win first; same dealer otherwise. */
export function nextDealer(game: GameState): number {
  const wins = game.settlements.filter(
    (s) => s.kind === 'zimo' || s.kind === 'dianpao' || s.kind === 'qianggang',
  );
  if (wins.length === 0) return game.dealer;
  const first = wins[0];
  const second = wins[1];
  if (
    second &&
    first.kind !== 'zimo' &&
    second.kind === first.kind &&
    second.from === first.from &&
    second.tile === first.tile &&
    game.settlements.indexOf(second) === game.settlements.indexOf(first) + 1
  )
    return first.from!;
  return first.seat;
}

export type RoomActionResult = { ok: true; room: RoomState } | { ok: false; error: string };

export function applyRoomAction(input: RoomState, seat: number, action: Action): RoomActionResult {
  if (input.phase !== 'playing' || !input.game) return { ok: false, error: 'no hand in progress' };
  const res: ActionResult = applyAction(input.game, seat, action);
  if (!res.ok) return res;
  const room = copyRoom(input);
  room.game = res.state;
  if (res.state.step.kind === 'ended') finishHand(room);
  return { ok: true, room };
}

function finishHand(room: RoomState): void {
  const game = room.game!;
  const deltas = handDeltas(game);
  room.totals = room.totals.map((t, i) => t + deltas[i]);
  room.history.push({
    handNo: room.handNo,
    dealer: game.dealer,
    deltas,
    winners: [...game.winOrder],
    reason: game.step.kind === 'ended' ? game.step.reason : 'wall-exhausted',
  });
  room.dealer = nextDealer(game);
  room.phase = 'handEnd';
}

export function endSession(input: RoomState): RoomState {
  const room = copyRoom(input);
  room.phase = 'finished';
  return room;
}
