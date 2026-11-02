/**
 * viewFor: the ONLY way game data leaves the host. Builds what one recipient may see.
 *
 * - A player sees their own hand plus public info about the others.
 * - A spectator sees the discard piles and tile-free status only (plus whatever the
 *   rules.spectator.visible switches allow). Hands are never included for spectators.
 */
import { FAN_EXTRA_NAMES } from './fan';
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
  type LegalActions,
  type Settlement,
  type SettlementKind,
} from './game';
import type { RoomPhase, RoomState } from './room';
import { FAN_NAMES } from './rules';
import type { Suit, Tile } from './tiles';
import type { MeldKind } from './types';

export const PROTOCOL_VERSION = 1;

export type Viewer = { kind: 'player'; seat: number; debugAll?: boolean } | { kind: 'spectator' };

export interface SeatView {
  name: string;
  kind: 'human' | 'ai' | 'empty';
  connected: boolean;
  total: number;
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
  items: { name: string; fan: number }[];
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
  deltas: number[];
}

export interface ClientView {
  v: number;
  role: 'player' | 'spectator';
  mySeat: number | null;
  code: string;
  phase: RoomPhase;
  handNo: number;
  seats: SeatView[];
  spectators: { name: string; connected: boolean }[];
  history: HandRecordView[];
  game: GameView | null;
  spectatorSlots: number;
}

function fanView(s: Settlement): FanView | undefined {
  if (!s.fan) return undefined;
  return {
    items: s.fan.items.map((i) => ({
      name:
        i.key in FAN_NAMES
          ? FAN_NAMES[i.key as keyof typeof FAN_NAMES] +
            (i.count && i.count > 1 ? `×${i.count}` : '')
          : FAN_EXTRA_NAMES[i.key as keyof typeof FAN_EXTRA_NAMES],
      fan: i.fan,
    })),
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

function gameViewFor(game: GameState, viewer: Viewer, deadlineMs: number | null): GameView {
  const step = game.step;
  const spectator = viewer.kind === 'spectator';
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
  return {
    v: PROTOCOL_VERSION,
    role: viewer.kind === 'player' ? 'player' : 'spectator',
    mySeat: viewer.kind === 'player' ? viewer.seat : null,
    code: room.code,
    phase: room.phase,
    handNo: room.handNo,
    seats: room.seats.map((s, i) => ({
      name: s?.name ?? '',
      kind: s ? s.kind : 'empty',
      connected: s ? s.connected : false,
      total: room.totals[i],
    })),
    spectators: room.spectators.map((s) => ({ name: s.name, connected: s.connected })),
    history: room.history.map((h) => ({ handNo: h.handNo, deltas: [...h.deltas] })),
    game: room.game ? gameViewFor(room.game, viewer, deadlineMs) : null,
    spectatorSlots: room.rules.spectator.slots,
  };
}
