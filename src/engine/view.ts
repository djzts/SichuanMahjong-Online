/**
 * viewFor: the ONLY way game data leaves the host. Builds what one recipient may see.
 *
 * - A player sees their own hand plus public info about the others.
 * - A spectator (观战者) and a member sitting the hand out (临时观察者) see the discard piles
 *   and tile-free status only (plus whatever rules.spectator.visible allows). Hands are never
 *   included for them.
 */
import {
  handDeltas,
  legalActions,
  pendingSeats,
  settlementDeltas,
  suggestExchange,
  suggestVoid,
  type ExchangeDir,
  type GameEventKind,
  type GameState,
  type KongUnpaidReason,
  type LegalActions,
  type Settlement,
  type SettlementKind,
} from './game';
import {
  seatOfMember,
  type BenchReason,
  type PlayerCount,
  type RoomPhase,
  type RoomState,
} from './room';
import type { Suit, Tile } from './tiles';
import type { MeldKind } from './types';

export const PROTOCOL_VERSION = 3;

/** Who is looking at a hand: a player at the table, or someone who only watches. */
export type GameViewer = { kind: 'player'; seat: number; debugAll?: boolean } | { kind: 'watcher' };

/** Who is looking at the room: one of the members, or a spectator. */
export type Viewer = { kind: 'member'; member: number; debugAll?: boolean } | { kind: 'spectator' };

/** One of the 4 table seats in the current hand. */
export interface SeatView {
  name: string;
  kind: 'human' | 'ai' | 'empty';
  connected: boolean;
  /** Live running total (includes the current hand so far). */
  total: number;
  member: number;
}

/** One of the 4–7 members of the session, for the scoreboard. */
export interface MemberView {
  /** 号位 (1-based). */
  no: number;
  name: string;
  kind: 'human' | 'ai' | 'empty';
  connected: boolean;
  /** Live running total (includes the current hand so far). */
  total: number;
  /** Change in the current hand; null when not playing it. */
  handDelta: number | null;
  /** Game seat this hand, or null when sitting out. */
  seat: number | null;
  status: 'table' | 'bench' | 'empty';
}

export interface RotationView {
  out: { member: number; reason: BenchReason }[];
  in: { member: number; seat: number }[];
  stayer?: { member: number; reason: 'first-winner' | 'draw-winner' };
}

export interface MeldView {
  kind: MeldKind;
  /** null for another player's concealed kong. */
  tile: Tile | null;
}

export interface PlayerPublicView {
  discards: Tile[];
  won: { order: number; selfDraw: boolean } | null;
  isDealer: boolean;
  /** Has made the current exchange / void-suit choice. */
  ready?: boolean;
  melds?: MeldView[];
  handCount?: number;
  voidSuit?: Suit | null;
  /**
   * A winner's hand (tile = winning tile), or at the end of the hand every remaining hand
   * (tile = null). Shown to players only, never to spectators.
   */
  revealed?: { hand: Tile[]; tile: Tile | null };
  /** Debug mode only (single-player). */
  debugHand?: Tile[];
}

export interface MyView {
  hand: Tile[];
  drawn: Tile | null;
  melds: MeldView[];
  voidSuit: Suit | null;
  huLocked: boolean;
  exchangePick: Tile[] | null;
  legal: LegalActions;
  suggestedExchange?: Tile[];
  suggestedVoid?: Suit;
}

export interface FanView {
  /** Fan keys (e.g. 'qingyise', 'gen', 'tianhu'); the client names them in its own language. */
  items: { key: string; fan: number; count?: number }[];
  fan: number;
  capped: boolean;
}

export interface SettlementView {
  kind: SettlementKind;
  seat: number;
  from?: number | null;
  meldKind?: MeldKind;
  tile?: Tile;
  fan?: FanView;
  /** A kong that counts but collects nothing. */
  unpaid?: KongUnpaidReason;
  deltas: number[];
}

export interface EventView {
  seq: number;
  seat: number;
  kind: GameEventKind;
  tile?: Tile;
  meldKind?: MeldKind;
}

export interface GameView {
  phase: 'exchange' | 'void' | 'play' | 'ended';
  endReason?: 'three-won' | 'wall-exhausted';
  dealer: number;
  /** Seat whose turn it is (or who just discarded while others may claim). */
  turn: number | null;
  wallCount: number;
  exchangeDir: ExchangeDir | null;
  players: PlayerPublicView[];
  me: MyView | null;
  /** The tile currently offered for claiming (discard or added kong). Players only. */
  claimTile?: { seat: number; tile: Tile; rob: boolean };
  waiting: number[];
  deadlineMs: number | null;
  events: EventView[];
  settlements: SettlementView[];
  handDeltas: number[];
}

export interface HandRecordView {
  handNo: number;
  /** Per member; null for members who sat that hand out. */
  deltas: (number | null)[];
}

export interface ClientView {
  v: number;
  /** player = at the table this hand; bench = 临时观察者; spectator = 观战者. */
  role: 'player' | 'bench' | 'spectator';
  mySeat: number | null;
  myMember: number | null;
  code: string;
  phase: RoomPhase;
  handNo: number;
  playerCount: PlayerCount;
  seats: SeatView[];
  members: MemberView[];
  spectators: { name: string; connected: boolean }[];
  history: HandRecordView[];
  game: GameView | null;
  spectatorSlots: number;
  /** Who sits out / comes in next hand (shown at the end of a hand). */
  rotation: RotationView | null;
}

function fanView(s: Settlement): FanView | undefined {
  if (!s.fan) return undefined;
  return {
    items: s.fan.items.map((i) =>
      i.count ? { key: i.key, fan: i.fan, count: i.count } : { key: i.key, fan: i.fan },
    ),
    fan: s.fan.fan,
    capped: s.fan.capped,
  };
}

function phaseOf(game: GameState): GameView['phase'] {
  switch (game.step.kind) {
    case 'exchange':
      return 'exchange';
    case 'void':
      return 'void';
    case 'ended':
      return 'ended';
    default:
      return 'play';
  }
}

export function gameViewFor(
  game: GameState,
  viewer: GameViewer,
  deadlineMs: number | null = null,
): GameView {
  const step = game.step;
  const spectator = viewer.kind === 'watcher';
  const vis = game.rules.spectator.visible;
  const mySeat = viewer.kind === 'player' ? viewer.seat : -1;
  const voidRevealed = step.kind !== 'exchange' && step.kind !== 'void';

  const players: PlayerPublicView[] = game.players.map((p, s) => {
    const v: PlayerPublicView = {
      discards: [...p.discards],
      won: p.won ? { order: p.won.order, selfDraw: p.won.selfDraw } : null,
      isDealer: s === game.dealer,
    };
    if (step.kind === 'exchange') v.ready = p.exchangePick !== null;
    if (step.kind === 'void') v.ready = p.voidSuit !== null;
    const showMelds = !spectator || vis.melds;
    if (showMelds)
      v.melds = p.melds.map((m) => ({
        kind: m.kind,
        tile: m.kind === 'kong-concealed' && s !== mySeat && !p.won ? null : m.tile,
      }));
    if (!spectator || vis.handCount) v.handCount = p.hand.length;
    if ((!spectator || vis.voidSuit) && (voidRevealed || s === mySeat)) v.voidSuit = p.voidSuit;
    if (!spectator && p.won) v.revealed = { hand: [...p.won.hand], tile: p.won.tile };
    else if (!spectator && step.kind === 'ended' && s !== mySeat)
      v.revealed = { hand: [...p.hand], tile: null };
    if (viewer.kind === 'player' && viewer.debugAll && s !== mySeat) v.debugHand = [...p.hand];
    return v;
  });

  let me: MyView | null = null;
  if (viewer.kind === 'player') {
    const p = game.players[viewer.seat];
    const legal = legalActions(game, viewer.seat);
    me = {
      hand: [...p.hand],
      drawn: p.drawn,
      melds: p.melds.map((m) => ({ kind: m.kind, tile: m.tile })),
      voidSuit: p.voidSuit,
      huLocked: p.huLocked,
      exchangePick: p.exchangePick ? [...p.exchangePick] : null,
      legal,
    };
    if (legal.exchange) me.suggestedExchange = suggestExchange(p.hand);
    if (legal.void) me.suggestedVoid = suggestVoid(p.hand);
  }

  const settlements: SettlementView[] = game.settlements.map((s) => {
    const v: SettlementView = {
      kind: s.kind,
      seat: s.seat,
      from: s.from,
      deltas: settlementDeltas(s),
    };
    if (s.unpaid) v.unpaid = s.unpaid;
    if (!spectator || vis.fanDetail) {
      const f = fanView(s);
      if (f) v.fan = f;
    }
    if (!spectator) {
      if (s.meldKind) v.meldKind = s.meldKind;
      const hiddenKong = s.meldKind === 'kong-concealed' && s.seat !== mySeat;
      if (s.tile !== undefined && !hiddenKong) v.tile = s.tile;
    }
    return v;
  });

  const events: EventView[] = [];
  for (const e of game.events.slice(-8)) {
    if (spectator) {
      if ((e.kind === 'pung' || e.kind === 'kong') && !vis.melds) continue;
      events.push({ seq: e.seq, seat: e.seat, kind: e.kind });
    } else {
      events.push({ ...e });
    }
  }

  let turn: number | null = null;
  if (step.kind === 'act') turn = step.seat;
  else if (step.kind === 'claim' || step.kind === 'rob') turn = step.from;

  const view: GameView = {
    phase: phaseOf(game),
    dealer: game.dealer,
    turn,
    wallCount: game.wall.length,
    exchangeDir: step.kind === 'exchange' ? null : game.exchangeDir,
    players,
    me,
    waiting: pendingSeats(game),
    deadlineMs,
    events,
    settlements,
    handDeltas: handDeltas(game),
  };
  if (step.kind === 'ended') view.endReason = step.reason;
  if (!spectator && (step.kind === 'claim' || step.kind === 'rob'))
    view.claimTile = { seat: step.from, tile: step.tile, rob: step.kind === 'rob' };
  return view;
}

export function viewFor(
  room: RoomState,
  viewer: Viewer,
  deadlineMs: number | null = null,
): ClientView {
  const inHand = room.phase === 'playing' || room.phase === 'handEnd';
  const myMember = viewer.kind === 'member' ? viewer.member : null;
  const mySeat = myMember !== null && inHand ? seatOfMember(room, myMember) : -1;
  const role: ClientView['role'] =
    viewer.kind === 'spectator' ? 'spectator' : !inHand || mySeat >= 0 ? 'player' : 'bench';
  const live = room.phase === 'playing' && room.game ? handDeltas(room.game) : null;
  const liveTotal = (m: number) => {
    const seat = seatOfMember(room, m);
    return room.totals[m] + (live && seat >= 0 ? live[seat] : 0);
  };
  let game: GameView | null = null;
  if (room.game && inHand)
    game =
      mySeat >= 0
        ? gameViewFor(
            room.game,
            {
              kind: 'player',
              seat: mySeat,
              debugAll: viewer.kind === 'member' && viewer.debugAll,
            },
            deadlineMs,
          )
        : gameViewFor(room.game, { kind: 'watcher' }, deadlineMs);
  const rot = room.phase === 'handEnd' ? room.nextRotation : null;
  return {
    v: PROTOCOL_VERSION,
    role,
    mySeat: mySeat >= 0 ? mySeat : null,
    myMember,
    code: room.code,
    phase: room.phase,
    handNo: room.handNo,
    playerCount: room.playerCount,
    seats: room.table.map((m) => {
      const s = room.members[m];
      return {
        name: s?.name ?? '',
        kind: s ? s.kind : 'empty',
        connected: s ? s.connected : false,
        total: liveTotal(m),
        member: m,
      };
    }),
    members: room.members.map((s, m) => {
      const seat = seatOfMember(room, m);
      return {
        no: m + 1,
        name: s?.name ?? '',
        kind: s ? s.kind : 'empty',
        connected: s ? s.connected : false,
        total: liveTotal(m),
        handDelta: live && seat >= 0 ? live[seat] : null,
        seat: seat >= 0 ? seat : null,
        status: !s ? 'empty' : seat >= 0 ? 'table' : 'bench',
      };
    }),
    spectators: room.spectators.map((s) => ({ name: s.name, connected: s.connected })),
    history: room.history.map((h) => ({ handNo: h.handNo, deltas: [...h.deltas] })),
    game,
    spectatorSlots: room.rules.spectator.slots,
    rotation: rot
      ? {
          out: rot.out.map((o) => ({ member: o.member, reason: o.reason })),
          in: rot.in.map((i) => ({ member: i.member, seat: i.seat })),
          ...(rot.stayer ? { stayer: { ...rot.stayer } } : {}),
        }
      : null,
  };
}
