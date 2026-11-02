/**
 * Room / session state: members (4–7 players), spectators, running totals, who sits at the
 * table for each hand, and the current hand.
 * Pure functions only — timers, AI scheduling and networking live in the controller.
 *
 * Terms:
 * - member: one of the 4–7 players of the session (号位). Members have a running score.
 * - table:  the 4 members playing the current hand; table[gameSeat] = member index.
 * - bench:  members sitting this hand out (临时观察者). They come back in next hand.
 * - spectator: watches only, never plays, has no score (观战者).
 */
import {
  applyAction,
  createGame,
  handDeltas,
  type Action,
  type ActionResult,
  type GameState,
  type Settlement,
} from './game';
import { shuffle } from './rng';
import type { Rules } from './rules';

export type SeatKind = 'human' | 'ai';
export type PlayerCount = 4 | 5 | 6 | 7;
export const PLAYER_COUNTS: readonly PlayerCount[] = [4, 5, 6, 7];

export interface Member {
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
  /** Members at the table for this hand (by game seat). */
  table: number[];
  /** Score change per member; null for members who sat this hand out. */
  deltas: (number | null)[];
  /** Winners as member indices, in winning order. */
  winners: number[];
  reason: 'three-won' | 'wall-exhausted';
}

/** Why a member sits out next hand. */
export type BenchReason =
  | 'dianpao' // 第一个点炮（或被抢杠）
  | 'zimo-opposite' // 第一个自摸者的对家
  | 'last-standing' // 最后一个没胡的
  | 'draw-loser' // 流局时输得最多
  | 'fallback' // 前两条落在同一个人身上时，补选的人
  | 'not-stayer'; // 7 人局：除了留下的那一家

export interface Rotation {
  out: { member: number; seat: number; reason: BenchReason }[];
  in: { member: number; seat: number }[];
  /** 7 人局 only: the member who stays at the table. */
  stayer?: { member: number; reason: 'first-winner' | 'draw-winner' };
  table: number[];
  bench: number[];
}

export type RoomPhase = 'lobby' | 'playing' | 'handEnd' | 'finished';

export interface RoomState {
  code: string;
  rules: Rules;
  playerCount: PlayerCount;
  /** Member 0 is always the host. `null` = empty slot. Length = playerCount. */
  members: (Member | null)[];
  /** table[gameSeat] = member index. */
  table: number[];
  /** Members sitting out the current hand (临时观察者). */
  bench: number[];
  spectators: SpectatorInfo[];
  phase: RoomPhase;
  handNo: number;
  /** Dealer as a game seat (the seat keeps the dealership if its player rotates out). */
  dealer: number;
  /** Running score per member. */
  totals: number[];
  history: HandRecord[];
  game: GameState | null;
  /** Computed when a hand ends; applied when the next hand starts. */
  nextRotation: Rotation | null;
}

export type Role = 'player' | 'spectator';

export type JoinResult =
  | { ok: true; room: RoomState; role: 'player'; member: number; note?: 'seats-full' }
  | { ok: true; room: RoomState; role: 'spectator'; note?: 'seats-full' }
  | { ok: false; reason: 'full' };

const AI_NAMES = [
  '电脑·小熊猫',
  '电脑·火锅',
  '电脑·川妹子',
  '电脑·担担面',
  '电脑·兔头',
  '电脑·冒菜',
];

function copyRoom(room: RoomState): RoomState {
  return {
    ...room,
    members: room.members.map((s) => (s ? { ...s } : null)),
    table: [...room.table],
    bench: [...room.bench],
    spectators: room.spectators.map((s) => ({ ...s })),
    totals: [...room.totals],
    history: [...room.history],
  };
}

function initialSeating(n: number): { table: number[]; bench: number[] } {
  return { table: [0, 1, 2, 3], bench: Array.from({ length: n - 4 }, (_, i) => i + 4) };
}

export function createRoom(
  code: string,
  rules: Rules,
  host: { playerId: string; name: string },
  playerCount: PlayerCount = 4,
): RoomState {
  const members: (Member | null)[] = Array.from({ length: playerCount }, () => null);
  members[0] = { kind: 'human', playerId: host.playerId, name: host.name, connected: true };
  return {
    code,
    rules,
    playerCount,
    members,
    ...initialSeating(playerCount),
    spectators: [],
    phase: 'lobby',
    handNo: 0,
    dealer: 0,
    totals: new Array<number>(playerCount).fill(0),
    history: [],
    game: null,
    nextRotation: null,
  };
}

/** Lobby only. Shrinking is refused while a person sits in a slot that would disappear. */
export function canSetPlayerCount(room: RoomState, n: PlayerCount): boolean {
  if (room.phase !== 'lobby') return false;
  return room.members.slice(n).every((m) => m === null || m.kind === 'ai');
}

export function setPlayerCount(input: RoomState, n: PlayerCount): RoomState {
  if (!canSetPlayerCount(input, n) || n === input.playerCount) return input;
  const room = copyRoom(input);
  room.members = Array.from({ length: n }, (_, i) => room.members[i] ?? null);
  room.playerCount = n;
  room.totals = new Array<number>(n).fill(0);
  Object.assign(room, initialSeating(n));
  return room;
}

export function findMember(room: RoomState, playerId: string): number {
  return room.members.findIndex((s) => s?.kind === 'human' && s.playerId === playerId);
}

export function findSpectator(room: RoomState, playerId: string): number {
  return room.spectators.findIndex((s) => s.playerId === playerId);
}

/** Game seat of a member in the current hand, or -1 if they sit it out. */
export function seatOfMember(room: RoomState, member: number): number {
  return room.table.indexOf(member);
}

/**
 * Seat a joining client. Known playerIds go back to where they were. During a game a
 * disconnected human member with the same nickname can be reclaimed (fallback match).
 */
export function joinRoom(
  input: RoomState,
  who: { playerId: string; name: string; role: Role },
): JoinResult {
  const room = copyRoom(input);
  const m = findMember(room, who.playerId);
  if (m >= 0) {
    room.members[m]!.connected = true;
    room.members[m]!.name = who.name || room.members[m]!.name;
    return { ok: true, room, role: 'player', member: m };
  }
  const spec = findSpectator(room, who.playerId);
  if (spec >= 0) {
    room.spectators[spec].connected = true;
    return { ok: true, room, role: 'spectator' };
  }
  let note: 'seats-full' | undefined;
  if (who.role === 'player') {
    if (room.phase === 'lobby') {
      const free = room.members.findIndex((s) => s === null);
      if (free >= 0) {
        room.members[free] = {
          kind: 'human',
          playerId: who.playerId,
          name: who.name,
          connected: true,
        };
        return { ok: true, room, role: 'player', member: free };
      }
    } else {
      const byName = room.members.findIndex(
        (s) => s?.kind === 'human' && !s.connected && s.name === who.name,
      );
      if (byName >= 0) {
        room.members[byName] = {
          ...room.members[byName]!,
          playerId: who.playerId,
          connected: true,
        };
        return { ok: true, room, role: 'player', member: byName };
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
  const m = findMember(room, playerId);
  if (m >= 0) {
    if (room.phase === 'lobby' && !connected && m !== 0) room.members[m] = null;
    else room.members[m]!.connected = connected;
  }
  const spec = findSpectator(room, playerId);
  if (spec >= 0) {
    if (room.phase === 'lobby' && !connected) room.spectators.splice(spec, 1);
    else room.spectators[spec].connected = connected;
  }
  return room;
}

export function setSeatAI(input: RoomState, member: number, ai: boolean): RoomState {
  if (input.phase !== 'lobby' || member <= 0 || member >= input.playerCount) return input;
  const room = copyRoom(input);
  const cur = room.members[member];
  if (ai && cur === null) {
    const used = new Set(room.members.map((s) => s?.name));
    const name = AI_NAMES.find((n) => !used.has(n)) ?? `电脑${member + 1}`;
    room.members[member] = { kind: 'ai', playerId: null, name, connected: true };
  } else if (!ai && cur?.kind === 'ai') {
    room.members[member] = null;
  }
  return room;
}

export function fillWithAI(input: RoomState): RoomState {
  let room = input;
  for (let s = 1; s < room.playerCount; s++)
    if (room.members[s] === null) room = setSeatAI(room, s, true);
  return room;
}

/** Lobby only: move a client between a player slot and a spectator slot. */
export function switchRole(input: RoomState, playerId: string, role: Role): RoomState {
  if (input.phase !== 'lobby') return input;
  const m = findMember(input, playerId);
  const spec = findSpectator(input, playerId);
  if (role === 'spectator' && m > 0) {
    if (input.spectators.length >= input.rules.spectator.slots) return input;
    const room = copyRoom(input);
    const info = room.members[m]!;
    room.members[m] = null;
    room.spectators.push({ playerId, name: info.name, connected: true });
    return room;
  }
  if (role === 'player' && spec >= 0) {
    const free = input.members.findIndex((s) => s === null);
    if (free < 0) return input;
    const room = copyRoom(input);
    const info = room.spectators.splice(spec, 1)[0];
    room.members[free] = { kind: 'human', playerId, name: info.name, connected: true };
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
    (room.phase === 'lobby' || room.phase === 'handEnd') && room.members.every((s) => s !== null)
  );
}

export function startHand(input: RoomState, seed: number): RoomState {
  if (!canStart(input)) return input;
  const room = copyRoom(input);
  if (room.phase === 'handEnd' && room.nextRotation) {
    room.table = [...room.nextRotation.table];
    room.bench = [...room.nextRotation.bench];
  }
  room.nextRotation = null;
  room.handNo++;
  room.phase = 'playing';
  room.game = createGame({ rules: room.rules, seed, dealer: room.dealer });
  return room;
}

const isWin = (s: Settlement) =>
  s.kind === 'zimo' || s.kind === 'dianpao' || s.kind === 'qianggang';

/** Who deals next: first winner; the discarder after a multi-win first; same dealer otherwise. */
export function nextDealer(game: GameState): number {
  const wins = game.settlements.filter(isWin);
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

/**
 * Who sits out next hand in 5/6/7-player sessions (game seats in, members out).
 *
 * - 5 人: the first player who dealt in (点炮 / 被抢杠), or the player opposite the first
 *   self-drawer (自摸三家的对家), sits out; last hand's bench player takes that seat.
 * - 6 人: that player plus the last one who did not win sit out; last hand's two bench
 *   players take the two seats in random order.
 * - 7 人: only one player stays (the first winner); the other three sit out; last hand's three
 *   bench players take their seats in random order.
 * Exhaustive draws and overlaps fall back to "who lost the most this hand" (see README).
 */
export function computeRotation(
  playerCount: PlayerCount,
  table: readonly number[],
  bench: readonly number[],
  game: GameState,
): Rotation | null {
  if (playerCount === 4) return null;
  const deltas = handDeltas(game);
  const wins = game.settlements.filter(isWin);
  const turnOrder = [0, 1, 2, 3].map((i) => (game.dealer + i) % 4);
  const orderIdx = (s: number) => turnOrder.indexOf(s);
  const winIdx = (s: number) => {
    const i = game.winOrder.indexOf(s);
    return i < 0 ? Infinity : i;
  };
  /** Biggest loser first: lowest delta, then the later (or non-) winner, then turn order. */
  const byLoss = (a: number, b: number) =>
    deltas[a] - deltas[b] || winIdx(b) - winIdx(a) || orderIdx(a) - orderIdx(b);
  const byGain = (a: number, b: number) =>
    deltas[b] - deltas[a] || winIdx(a) - winIdx(b) || orderIdx(a) - orderIdx(b);

  const out: { seat: number; reason: BenchReason }[] = [];
  let stayer: Rotation['stayer'];

  if (playerCount === 7) {
    let stay: number;
    if (wins.length) {
      stay = wins[0].seat;
      stayer = { member: table[stay], reason: 'first-winner' };
    } else {
      stay = [0, 1, 2, 3].sort(byGain)[0];
      stayer = { member: table[stay], reason: 'draw-winner' };
    }
    for (const s of turnOrder) if (s !== stay) out.push({ seat: s, reason: 'not-stayer' });
  } else {
    let first: { seat: number; reason: BenchReason };
    if (wins.length) {
      const w = wins[0];
      first =
        w.kind === 'zimo'
          ? { seat: (w.seat + 2) % 4, reason: 'zimo-opposite' }
          : { seat: w.from!, reason: 'dianpao' };
    } else {
      first = { seat: [0, 1, 2, 3].sort(byLoss)[0], reason: 'draw-loser' };
    }
    out.push(first);
    if (playerCount === 6) {
      const notWon = [0, 1, 2, 3].filter((s) => !game.winOrder.includes(s));
      let second: { seat: number; reason: BenchReason } | null = null;
      if (notWon.length === 1 && notWon[0] !== first.seat)
        second = { seat: notWon[0], reason: 'last-standing' };
      else if (notWon.length > 1) {
        const pick = notWon.filter((s) => s !== first.seat).sort(byLoss)[0];
        second = { seat: pick, reason: 'draw-loser' };
      }
      if (!second) {
        const pick = [0, 1, 2, 3].filter((s) => s !== first.seat).sort(byLoss)[0];
        second = { seat: pick, reason: 'fallback' };
      }
      out.push(second);
    }
  }

  const seats = out.map((o) => o.seat).sort((a, b) => a - b);
  const joiners = shuffle(bench, game.rng ^ 0x5eed)[0];
  const newTable = [...table];
  const ins = seats.map((seat, i) => {
    newTable[seat] = joiners[i];
    return { member: joiners[i], seat };
  });
  return {
    out: out.map((o) => ({ member: table[o.seat], seat: o.seat, reason: o.reason })),
    in: ins,
    stayer,
    table: newTable,
    bench: out.map((o) => table[o.seat]),
  };
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
  const seatDeltas = handDeltas(game);
  const deltas: (number | null)[] = new Array(room.playerCount).fill(null);
  room.table.forEach((m, seat) => {
    deltas[m] = seatDeltas[seat];
    room.totals[m] += seatDeltas[seat];
  });
  room.history.push({
    handNo: room.handNo,
    dealer: game.dealer,
    table: [...room.table],
    deltas,
    winners: game.winOrder.map((s) => room.table[s]),
    reason: game.step.kind === 'ended' ? game.step.reason : 'wall-exhausted',
  });
  room.dealer = nextDealer(game);
  room.nextRotation = computeRotation(room.playerCount, room.table, room.bench, game);
  room.phase = 'handEnd';
}

export function endSession(input: RoomState): RoomState {
  const room = copyRoom(input);
  room.phase = 'finished';
  return room;
}
