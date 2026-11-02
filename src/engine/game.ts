/**
 * The game reducer for one hand of 血战到底.
 *
 * applyAction(state, seat, action) returns a new state (the input is never mutated) or an
 * error. Everything random is driven by the seeded PRNG stored in the state, so a hand can be
 * replayed from its seed and action log.
 */
import { calcFan, capAmount, maxReadyFan, winAmount, type FanResult } from './fan';
import { isWinningCounts } from './hand';
import { randomInt, shuffle } from './rng';
import type { Rules } from './rules';
import { countTile, countsOf, fullSet, removeTiles, suitOf, type Suit, type Tile } from './tiles';
import type { Meld, MeldKind } from './types';

export type ExchangeDir = 'cw' | 'ccw' | 'across';

export interface Payment {
  from: number;
  to: number;
  amount: number;
}

export interface WinRecord {
  order: number;
  tile: Tile;
  selfDraw: boolean;
  from: number | null;
  hand: Tile[];
  fan: FanResult;
}

export type SettlementKind =
  'zimo' | 'dianpao' | 'qianggang' | 'kong' | 'transfer' | 'huazhu' | 'dajiao' | 'refund';

export interface Settlement {
  kind: SettlementKind;
  /** Main actor: the winner, the player who made the kong, or the paying player for draw checks. */
  seat: number;
  from?: number | null;
  tile?: Tile;
  meldKind?: MeldKind;
  fan?: FanResult;
  /** A kong that still counts as a kong but collects nothing, and why. */
  unpaid?: KongUnpaidReason;
  payments: Payment[];
}

/**
 * - pung-then-kong: 先碰后杠 — punged while holding a concealed triplet, konged later.
 * - late-added-kong: 贴杠没有当轮贴 — the 4th tile was not drawn in the turn it was added.
 */
export type KongUnpaidReason = 'pung-then-kong' | 'late-added-kong';

export interface PlayerState {
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  voidSuit: Suit | null;
  exchangePick: Tile[] | null;
  won: WinRecord | null;
  huLocked: boolean;
  drawn: Tile | null;
  draws: number;
  /** Kong payments received this hand (for 退税). */
  kongIncome: Payment[];
  /** Tiles drawn during the current turn (regular draw + kong replacements). */
  turnDraws: Tile[];
}

export interface ClaimOptions {
  hu: boolean;
  pung: boolean;
  kong: boolean;
}

export type ClaimResponse = 'hu' | 'pung' | 'kong' | 'pass';

export type Step =
  | { kind: 'exchange' }
  | { kind: 'void' }
  | { kind: 'act'; seat: number; drew: boolean; afterKong: boolean }
  | {
      kind: 'claim';
      tile: Tile;
      from: number;
      afterKong: boolean;
      options: (ClaimOptions | null)[];
      responses: (ClaimResponse | null)[];
    }
  | {
      kind: 'rob';
      tile: Tile;
      from: number;
      options: (ClaimOptions | null)[];
      responses: (ClaimResponse | null)[];
    }
  | { kind: 'ended'; reason: 'three-won' | 'wall-exhausted' };

export type GameEventKind =
  'exchange' | 'void' | 'discard' | 'pung' | 'kong' | 'hu' | 'zimo' | 'qianggang' | 'ended';

export interface GameEvent {
  seq: number;
  seat: number;
  kind: GameEventKind;
  tile?: Tile;
  meldKind?: MeldKind;
}

export type Action =
  | { type: 'exchange'; tiles: Tile[] }
  | { type: 'void'; suit: Suit }
  | { type: 'discard'; tile: Tile }
  | { type: 'kong'; tile?: Tile }
  | { type: 'hu' }
  | { type: 'pung' }
  | { type: 'pass' };

export interface GameState {
  rules: Rules;
  seed: number;
  rng: number;
  dealer: number;
  wall: Tile[];
  players: PlayerState[];
  step: Step;
  exchangeDir: ExchangeDir;
  discardCount: number;
  anyMeld: boolean;
  winOrder: number[];
  settlements: Settlement[];
  lastKong: { seat: number; payments: Payment[] } | null;
  events: GameEvent[];
  eventSeq: number;
  log: { seat: number; action: Action }[];
}

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };

export const SEATS = 4;
export const nextSeat = (s: number): number => (s + 1) % SEATS;

// ---------------------------------------------------------------------------
// Creation

export interface CreateGameOptions {
  rules: Rules;
  seed: number;
  dealer: number;
  /** Testing hook: fixed starting hands (dealer 14, others 13) and wall. */
  preset?: { hands: Tile[][]; wall: Tile[]; exchangeDir?: ExchangeDir };
}

function emptyPlayer(hand: Tile[]): PlayerState {
  return {
    hand: [...hand].sort((a, b) => a - b),
    melds: [],
    discards: [],
    voidSuit: null,
    exchangePick: null,
    won: null,
    huLocked: false,
    drawn: null,
    draws: 0,
    kongIncome: [],
    turnDraws: [],
  };
}

export function createGame(opts: CreateGameOptions): GameState {
  let rng = opts.seed >>> 0;
  let hands: Tile[][];
  let wall: Tile[];
  let exchangeDir: ExchangeDir;
  if (opts.preset) {
    hands = opts.preset.hands.map((h) => [...h]);
    wall = [...opts.preset.wall];
    exchangeDir = opts.preset.exchangeDir ?? 'ccw';
  } else {
    let tiles: Tile[];
    [tiles, rng] = shuffle(fullSet(), rng);
    hands = [[], [], [], []];
    let k = 0;
    for (let i = 0; i < SEATS; i++) {
      const seat = (opts.dealer + i) % SEATS;
      const n = seat === opts.dealer ? 14 : 13;
      hands[seat] = tiles.slice(k, k + n);
      k += n;
    }
    wall = tiles.slice(k);
    let d: number;
    [d, rng] = randomInt(rng, 3);
    exchangeDir = (['cw', 'ccw', 'across'] as const)[d];
  }
  const players = hands.map(emptyPlayer);
  players[opts.dealer].draws = 1;
  return {
    rules: opts.rules,
    seed: opts.seed,
    rng,
    dealer: opts.dealer,
    wall,
    players,
    step: opts.rules.exchangeThree ? { kind: 'exchange' } : { kind: 'void' },
    exchangeDir,
    discardCount: 0,
    anyMeld: false,
    winOrder: [],
    settlements: [],
    lastKong: null,
    events: [],
    eventSeq: 0,
    log: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers

function cloneStep(step: Step): Step {
  if (step.kind === 'claim' || step.kind === 'rob') {
    return {
      ...step,
      options: step.options.map((o) => (o ? { ...o } : null)),
      responses: [...step.responses],
    };
  }
  return { ...step };
}

function cloneState(s: GameState): GameState {
  return {
    ...s,
    wall: [...s.wall],
    players: s.players.map((p) => ({
      ...p,
      hand: [...p.hand],
      melds: p.melds.map((m) => ({ ...m })),
      discards: [...p.discards],
      exchangePick: p.exchangePick ? [...p.exchangePick] : null,
      kongIncome: [...p.kongIncome],
      turnDraws: [...p.turnDraws],
    })),
    step: cloneStep(s.step),
    winOrder: [...s.winOrder],
    settlements: [...s.settlements],
    lastKong: s.lastKong ? { ...s.lastKong, payments: [...s.lastKong.payments] } : null,
    events: [...s.events],
    log: [...s.log],
  };
}

function insertSorted(hand: Tile[], t: Tile): void {
  let i = 0;
  while (i < hand.length && hand[i] <= t) i++;
  hand.splice(i, 0, t);
}

export function hasVoidTiles(p: PlayerState): boolean {
  return p.voidSuit !== null && p.hand.some((t) => suitOf(t) === p.voidSuit);
}

export function isActive(state: GameState, seat: number): boolean {
  return state.players[seat].won === null;
}

export function activeSeats(state: GameState): number[] {
  return [0, 1, 2, 3].filter((s) => isActive(state, s));
}

export function nextActive(state: GameState, seat: number): number {
  let s = nextSeat(seat);
  for (let i = 0; i < SEATS; i++) {
    if (isActive(state, s)) return s;
    s = nextSeat(s);
  }
  return -1;
}

function emit(state: GameState, e: Omit<GameEvent, 'seq'>): void {
  state.eventSeq++;
  state.events.push({ ...e, seq: state.eventSeq });
}

function canWinWith(p: PlayerState, tile: Tile): boolean {
  if (p.won || p.huLocked || hasVoidTiles(p)) return false;
  if (p.voidSuit !== null && suitOf(tile) === p.voidSuit) return false;
  const c = countsOf(p.hand);
  c[tile]++;
  return isWinningCounts(c, p.melds.length);
}

export function canSelfDrawWin(p: PlayerState): boolean {
  if (p.won || hasVoidTiles(p)) return false;
  return isWinningCounts(countsOf(p.hand), p.melds.length);
}

/** Distinct tiles the player may discard (void-suit tiles first). */
export function discardableTiles(p: PlayerState): Tile[] {
  const voids = hasVoidTiles(p);
  const out: Tile[] = [];
  for (const t of p.hand) {
    if (voids && suitOf(t) !== p.voidSuit) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Tiles the player can kong on their own turn (concealed or added). */
export function selfKongTiles(state: GameState, p: PlayerState): Tile[] {
  if (state.wall.length === 0) return [];
  const out: Tile[] = [];
  for (const t of p.hand) {
    if (out.includes(t)) continue;
    if (p.voidSuit !== null && suitOf(t) === p.voidSuit) continue;
    if (countTile(p.hand, t) === 4) out.push(t);
    else if (p.melds.some((m) => m.kind === 'pung' && m.tile === t)) out.push(t);
  }
  return out;
}

function claimOptions(state: GameState, from: number, tile: Tile): (ClaimOptions | null)[] {
  return state.players.map((p, s) => {
    if (s === from || p.won) return null;
    const voidHit = p.voidSuit !== null && suitOf(tile) === p.voidSuit;
    const n = countTile(p.hand, tile);
    const wallLeft = state.wall.length > 0;
    const o: ClaimOptions = {
      hu: canWinWith(p, tile),
      pung: wallLeft && !voidHit && n >= 2,
      kong: wallLeft && !voidHit && n === 3,
    };
    return o.hu || o.pung || o.kong ? o : null;
  });
}

function robOptions(state: GameState, from: number, tile: Tile): (ClaimOptions | null)[] {
  return state.players.map((p, s) => {
    if (s === from || p.won) return null;
    return canWinWith(p, tile) ? { hu: true, pung: false, kong: false } : null;
  });
}

function addSettlement(state: GameState, s: Settlement): void {
  state.settlements.push(s);
}

function kongPayments(state: GameState, seat: number, kind: MeldKind, from?: number): Payment[] {
  const r = state.rules;
  if (!r.windRain) return [];
  const pays: Payment[] = [];
  if (kind === 'kong-exposed' && from !== undefined) {
    pays.push({ from, to: seat, amount: 2 * r.baseScore });
  } else {
    const unit = kind === 'kong-concealed' ? 2 : 1;
    for (const s of activeSeats(state))
      if (s !== seat) pays.push({ from: s, to: seat, amount: unit * r.baseScore });
  }
  return pays;
}

function settleKong(
  state: GameState,
  seat: number,
  kind: MeldKind,
  tile: Tile,
  from?: number,
  unpaid?: KongUnpaidReason,
) {
  const payments = unpaid ? [] : kongPayments(state, seat, kind, from);
  state.players[seat].kongIncome.push(...payments);
  state.lastKong = { seat, payments };
  const s: Settlement = { kind: 'kong', seat, from: from ?? null, tile, meldKind: kind, payments };
  if (unpaid) s.unpaid = unpaid;
  addSettlement(state, s);
}

/** Why an added kong on `tile` would collect nothing right now (null = it gets paid). */
export function addedKongUnpaid(
  state: GameState,
  p: PlayerState,
  tile: Tile,
): KongUnpaidReason | null {
  if (!state.rules.strictAddedKongPay) return null;
  const meld = p.melds.find((m) => m.kind === 'pung' && m.tile === tile);
  if (!meld) return null;
  if (meld.heldFourth) return 'pung-then-kong';
  if (!p.turnDraws.includes(tile)) return 'late-added-kong';
  return null;
}

// ---------------------------------------------------------------------------
// Turn flow

function startAct(state: GameState, seat: number, drew: boolean, afterKong: boolean): void {
  state.step = { kind: 'act', seat, drew, afterKong };
}

/** `newTurn`: this draw starts the player's turn (regular draw, or replacement after 明杠). */
function drawFor(state: GameState, seat: number, fromTail: boolean, newTurn: boolean): void {
  const tile = fromTail ? state.wall.pop()! : state.wall.shift()!;
  const p = state.players[seat];
  if (newTurn) p.turnDraws = [];
  p.turnDraws.push(tile);
  insertSorted(p.hand, tile);
  p.drawn = tile;
  p.draws++;
  p.huLocked = false;
  startAct(state, seat, true, fromTail);
}

function nextTurn(state: GameState, seat: number): void {
  if (seat < 0) return endHand(state, 'three-won');
  if (state.wall.length === 0) return endHand(state, 'wall-exhausted');
  drawFor(state, seat, false, true);
}

function afterWin(state: GameState, lastWinner: number): void {
  state.lastKong = null;
  if (activeSeats(state).length <= 1) return endHand(state, 'three-won');
  nextTurn(state, nextActive(state, lastWinner));
}

function recordWin(
  state: GameState,
  seat: number,
  tile: Tile,
  selfDraw: boolean,
  from: number | null,
  fan: FanResult,
  hand?: Tile[],
): void {
  const p = state.players[seat];
  state.winOrder.push(seat);
  p.won = {
    order: state.winOrder.length,
    tile,
    selfDraw,
    from,
    hand: hand ?? [...p.hand],
    fan,
  };
  p.drawn = null;
}

function endHand(state: GameState, reason: 'three-won' | 'wall-exhausted'): void {
  state.step = { kind: 'ended', reason };
  for (const p of state.players) p.drawn = null;
  if (reason === 'wall-exhausted') settleExhaustiveDraw(state);
  emit(state, { seat: -1, kind: 'ended' });
}

/** 查花猪, 查大叫 and 退税 among players who have not won. */
function settleExhaustiveDraw(state: GameState): void {
  const r = state.rules;
  const active = activeSeats(state);
  if (active.length < 2) return;
  const huazhu = active.filter((s) => hasVoidTiles(state.players[s]));
  const clean = active.filter((s) => !huazhu.includes(s));
  const readyFan = new Map<number, number>();
  for (const s of clean) {
    const p = state.players[s];
    const f = maxReadyFan(p.hand, p.melds, r);
    if (f !== null) readyFan.set(s, f);
  }
  const ready = clean.filter((s) => readyFan.has(s));
  const notReady = clean.filter((s) => !readyFan.has(s));

  for (const h of huazhu) {
    const payments = clean.map((to) => ({ from: h, to, amount: capAmount(r) }));
    if (payments.length) addSettlement(state, { kind: 'huazhu', seat: h, payments });
  }
  for (const n of notReady) {
    const payments = ready.map((to) => ({
      from: n,
      to,
      amount: r.baseScore * 2 ** Math.min(readyFan.get(to)!, r.capFan),
    }));
    if (payments.length) addSettlement(state, { kind: 'dajiao', seat: n, payments });
  }
  if (r.refundOnDraw) {
    for (const s of [...huazhu, ...notReady]) {
      const income = state.players[s].kongIncome;
      if (income.length === 0) continue;
      addSettlement(state, {
        kind: 'refund',
        seat: s,
        payments: income.map((p) => ({ from: s, to: p.from, amount: p.amount })),
      });
    }
  }
}

function resolveDiscardWins(state: GameState, from: number, tile: Tile, winners: number[]) {
  const step = state.step as Extract<Step, { kind: 'claim' }>;
  const discarder = state.players[from];
  discarder.discards.pop();
  const lastTile = state.wall.length === 0;
  winners.forEach((w, i) => {
    const p = state.players[w];
    const hand = [...p.hand];
    insertSorted(hand, tile);
    // The physical tile goes to the first winner; other winners of 一炮多响 share it.
    if (i === 0) p.hand = [...hand];
    const fan = calcFan(
      hand,
      p.melds,
      { selfDraw: false, kongDiscard: step.afterKong, lastTile },
      state.rules,
    )!;
    recordWin(state, w, tile, false, from, fan, hand);
    addSettlement(state, {
      kind: 'dianpao',
      seat: w,
      from,
      tile,
      fan,
      payments: [{ from, to: w, amount: winAmount(fan, false, state.rules) }],
    });
    emit(state, { seat: w, kind: 'hu', tile });
  });
  // 呼叫转移: the kong money of a 杠上炮 goes to the (first) winner.
  const lk = state.lastKong;
  if (state.rules.callTransfer && step.afterKong && lk && lk.seat === from && lk.payments.length) {
    const total = lk.payments.reduce((a, p) => a + p.amount, 0);
    const income = discarder.kongIncome;
    for (const pay of lk.payments) {
      const i = income.indexOf(pay);
      if (i >= 0) income.splice(i, 1);
    }
    addSettlement(state, {
      kind: 'transfer',
      seat: from,
      from,
      payments: [{ from, to: winners[0], amount: total }],
    });
  }
  afterWin(state, winners[winners.length - 1]);
}

function orderFrom(from: number): number[] {
  return [1, 2, 3].map((i) => (from + i) % SEATS);
}

function tryResolveClaim(state: GameState): void {
  const step = state.step;
  if (step.kind !== 'claim') return;
  const order = orderFrom(step.from);
  const huCapable = order.filter((s) => step.options[s]?.hu);
  if (huCapable.some((s) => step.responses[s] === null)) return;
  let huers = order.filter((s) => step.responses[s] === 'hu');
  if (huers.length) {
    if (!state.rules.multipleWinners) huers = [huers[0]];
    return resolveDiscardWins(state, step.from, step.tile, huers);
  }
  const others = order.filter((s) => step.options[s] && !step.options[s]!.hu);
  if (others.some((s) => step.responses[s] === null)) return;
  // Hu-capable seats that also could pung/kong answered too; take any pung/kong response.
  const claimer = order.find((s) => step.responses[s] === 'pung' || step.responses[s] === 'kong');
  const tile = step.tile;
  const from = step.from;
  if (claimer === undefined) {
    state.lastKong = null;
    return nextTurn(state, nextActive(state, from));
  }
  const p = state.players[claimer];
  state.players[from].discards.pop();
  state.anyMeld = true;
  if (step.responses[claimer] === 'kong') {
    removeTiles(p.hand, tile, 3);
    p.melds.push({ kind: 'kong-exposed', tile, from });
    emit(state, { seat: claimer, kind: 'kong', tile, meldKind: 'kong-exposed' });
    settleKong(state, claimer, 'kong-exposed', tile, from);
    drawFor(state, claimer, true, true);
  } else {
    const heldFourth = countTile(p.hand, tile) === 3;
    removeTiles(p.hand, tile, 2);
    p.melds.push(
      heldFourth ? { kind: 'pung', tile, from, heldFourth } : { kind: 'pung', tile, from },
    );
    p.drawn = null;
    p.turnDraws = [];
    state.lastKong = null;
    emit(state, { seat: claimer, kind: 'pung', tile });
    startAct(state, claimer, false, false);
  }
}

function tryResolveRob(state: GameState): void {
  const step = state.step;
  if (step.kind !== 'rob') return;
  const order = orderFrom(step.from);
  if (order.some((s) => step.options[s] && step.responses[s] === null)) return;
  let huers = order.filter((s) => step.responses[s] === 'hu');
  const { tile, from } = step;
  if (huers.length) {
    if (!state.rules.multipleWinners) huers = [huers[0]];
    huers.forEach((w, i) => {
      const p = state.players[w];
      const hand = [...p.hand];
      insertSorted(hand, tile);
      if (i === 0) p.hand = [...hand];
      const fan = calcFan(hand, p.melds, { selfDraw: false, robKong: true }, state.rules)!;
      recordWin(state, w, tile, false, from, fan, hand);
      addSettlement(state, {
        kind: 'qianggang',
        seat: w,
        from,
        tile,
        fan,
        payments: [{ from, to: w, amount: winAmount(fan, false, state.rules) }],
      });
      emit(state, { seat: w, kind: 'qianggang', tile });
    });
    return afterWin(state, huers[huers.length - 1]);
  }
  completeAddedKong(state, from, tile);
}

function completeAddedKong(state: GameState, seat: number, tile: Tile): void {
  const p = state.players[seat];
  const meld = p.melds.find((m) => m.kind === 'pung' && m.tile === tile)!;
  const unpaid = addedKongUnpaid(state, p, tile) ?? undefined;
  meld.kind = 'kong-added';
  emit(state, { seat, kind: 'kong', tile, meldKind: 'kong-added' });
  settleKong(state, seat, 'kong-added', tile, undefined, unpaid);
  drawFor(state, seat, true, false);
}

// ---------------------------------------------------------------------------
// Reducer

function fail(error: string): ActionResult {
  return { ok: false, error };
}

export function applyAction(input: GameState, seat: number, action: Action): ActionResult {
  if (seat < 0 || seat >= SEATS) return fail('bad seat');
  const state = cloneState(input);
  const step = state.step;
  const p = state.players[seat];
  if (step.kind === 'ended') return fail('hand is over');
  if (p.won) return fail('already won');

  switch (step.kind) {
    case 'exchange': {
      if (action.type !== 'exchange') return fail('expected exchange');
      if (p.exchangePick) return fail('already picked');
      const tiles = action.tiles;
      if (tiles.length !== 3) return fail('pick exactly 3 tiles');
      if (new Set(tiles.map(suitOf)).size !== 1) return fail('tiles must share a suit');
      const c = countsOf(p.hand);
      for (const t of tiles) if (--c[t] < 0) return fail('tile not in hand');
      p.exchangePick = [...tiles];
      if (state.players.every((x) => x.exchangePick)) {
        const offset = { cw: 3, ccw: 1, across: 2 }[state.exchangeDir];
        const picks = state.players.map((x) => x.exchangePick!);
        state.players.forEach((x, s) => {
          for (const t of picks[s]) removeTiles(x.hand, t);
        });
        state.players.forEach((_x, s) => {
          const target = state.players[(s + offset) % SEATS];
          for (const t of picks[s]) insertSorted(target.hand, t);
        });
        state.step = { kind: 'void' };
        emit(state, { seat: -1, kind: 'exchange' });
      }
      break;
    }
    case 'void': {
      if (action.type !== 'void') return fail('expected void');
      if (p.voidSuit !== null) return fail('already chosen');
      if (![0, 1, 2].includes(action.suit)) return fail('bad suit');
      p.voidSuit = action.suit;
      if (state.players.every((x) => x.voidSuit !== null)) {
        emit(state, { seat: -1, kind: 'void' });
        startAct(state, state.dealer, true, false);
      }
      break;
    }
    case 'act': {
      if (seat !== step.seat) return fail('not your turn');
      if (action.type === 'discard') {
        if (!discardableTiles(p).includes(action.tile)) return fail('cannot discard that tile');
        removeTiles(p.hand, action.tile);
        p.discards.push(action.tile);
        p.drawn = null;
        state.discardCount++;
        emit(state, { seat, kind: 'discard', tile: action.tile });
        const options = claimOptions(state, seat, action.tile);
        if (options.some((o) => o)) {
          state.step = {
            kind: 'claim',
            tile: action.tile,
            from: seat,
            afterKong: step.afterKong,
            options,
            responses: [null, null, null, null],
          };
        } else {
          state.lastKong = null;
          nextTurn(state, nextActive(state, seat));
        }
      } else if (action.type === 'hu') {
        if (!step.drew || !canSelfDrawWin(p)) return fail('cannot win');
        const heavenly = seat === state.dealer && state.discardCount === 0 && !state.anyMeld;
        const earthly = seat !== state.dealer && p.draws === 1 && !state.anyMeld;
        const fan = calcFan(
          p.hand,
          p.melds,
          {
            selfDraw: true,
            kongFlower: step.afterKong,
            lastTile: state.wall.length === 0,
            heavenly,
            earthly,
          },
          state.rules,
        )!;
        const tile = p.drawn ?? p.hand[p.hand.length - 1];
        const amount = winAmount(fan, true, state.rules);
        const payments = activeSeats(state)
          .filter((s) => s !== seat)
          .map((s) => ({ from: s, to: seat, amount }));
        recordWin(state, seat, tile, true, null, fan);
        addSettlement(state, { kind: 'zimo', seat, tile, fan, payments });
        emit(state, { seat, kind: 'zimo', tile });
        afterWin(state, seat);
      } else if (action.type === 'kong') {
        if (!step.drew) return fail('cannot kong now');
        const options = selfKongTiles(state, p);
        const tile = action.tile ?? options[0];
        if (tile === undefined || !options.includes(tile)) return fail('cannot kong that tile');
        state.anyMeld = true;
        p.drawn = null;
        if (countTile(p.hand, tile) === 4) {
          removeTiles(p.hand, tile, 4);
          p.melds.push({ kind: 'kong-concealed', tile });
          emit(state, { seat, kind: 'kong', meldKind: 'kong-concealed' });
          settleKong(state, seat, 'kong-concealed', tile);
          drawFor(state, seat, true, false);
        } else {
          removeTiles(p.hand, tile, 1);
          const options2 = robOptions(state, seat, tile);
          if (options2.some((o) => o)) {
            state.step = {
              kind: 'rob',
              tile,
              from: seat,
              options: options2,
              responses: [null, null, null, null],
            };
          } else {
            completeAddedKong(state, seat, tile);
          }
        }
      } else {
        return fail('illegal action');
      }
      break;
    }
    case 'claim':
    case 'rob': {
      const opt = step.options[seat];
      if (!opt) return fail('nothing to respond to');
      if (step.responses[seat] !== null) return fail('already responded');
      let resp: ClaimResponse;
      if (action.type === 'pass') resp = 'pass';
      else if (action.type === 'hu' && opt.hu) resp = 'hu';
      else if (action.type === 'pung' && opt.pung) resp = 'pung';
      else if (action.type === 'kong' && opt.kong) resp = 'kong';
      else return fail('illegal response');
      step.responses[seat] = resp;
      if (opt.hu && resp !== 'hu' && state.rules.passHuLock) p.huLocked = true;
      if (step.kind === 'claim') tryResolveClaim(state);
      else tryResolveRob(state);
      break;
    }
  }
  state.log.push({ seat, action });
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// Queries

export interface LegalActions {
  exchange?: boolean;
  void?: boolean;
  discard?: Tile[];
  selfHu?: boolean;
  kongs?: Tile[];
  /** Subset of `kongs` that would count as a kong but collect nothing. */
  unpaidKongs?: Tile[];
  claim?: { tile: Tile; hu: boolean; pung: boolean; kong: boolean };
  rob?: { tile: Tile };
}

export function legalActions(state: GameState, seat: number): LegalActions {
  const step = state.step;
  const p = state.players[seat];
  if (p.won) return {};
  switch (step.kind) {
    case 'exchange':
      return p.exchangePick ? {} : { exchange: true };
    case 'void':
      return p.voidSuit === null ? { void: true } : {};
    case 'act':
      if (step.seat !== seat) return {};
      return {
        discard: discardableTiles(p),
        selfHu: step.drew && canSelfDrawWin(p),
        kongs: step.drew ? selfKongTiles(state, p) : [],
        unpaidKongs: step.drew
          ? selfKongTiles(state, p).filter((t) => addedKongUnpaid(state, p, t) !== null)
          : [],
      };
    case 'claim': {
      const o = step.options[seat];
      if (!o || step.responses[seat] !== null) return {};
      return { claim: { tile: step.tile, ...o } };
    }
    case 'rob': {
      const o = step.options[seat];
      if (!o || step.responses[seat] !== null) return {};
      return { rob: { tile: step.tile } };
    }
    default:
      return {};
  }
}

/** Seats whose input the game is waiting for. */
export function pendingSeats(state: GameState): number[] {
  return [0, 1, 2, 3].filter((s) => {
    const a = legalActions(state, s);
    return Object.keys(a).length > 0;
  });
}

/** Net score change of each seat in this hand so far. */
export function handDeltas(state: GameState): number[] {
  const d = [0, 0, 0, 0];
  for (const s of state.settlements)
    for (const p of s.payments) {
      d[p.from] -= p.amount;
      d[p.to] += p.amount;
    }
  return d;
}

export function settlementDeltas(s: Settlement): number[] {
  const d = [0, 0, 0, 0];
  for (const p of s.payments) {
    d[p.from] -= p.amount;
    d[p.to] += p.amount;
  }
  return d;
}

/** Shortest suit that has at least 3 tiles, and the 3 least-connected tiles from it. */
export function suggestExchange(hand: readonly Tile[]): Tile[] {
  const bySuit: Tile[][] = [[], [], []];
  for (const t of hand) bySuit[suitOf(t)].push(t);
  const candidates = [0, 1, 2]
    .filter((s) => bySuit[s].length >= 3)
    .sort((a, b) => bySuit[a].length - bySuit[b].length);
  const tiles = [...bySuit[candidates[0]]];
  const c = countsOf(tiles);
  const score = (t: Tile) => {
    let v = (c[t] - 1) * 3;
    const r = t % 9;
    if (r > 0) v += c[t - 1] * 2;
    if (r < 8) v += c[t + 1] * 2;
    if (r > 1) v += c[t - 2];
    if (r < 7) v += c[t + 2];
    return v;
  };
  tiles.sort((a, b) => score(a) - score(b) || a - b);
  return tiles.slice(0, 3);
}

export function suggestVoid(hand: readonly Tile[]): Suit {
  const n = [0, 0, 0];
  for (const t of hand) n[suitOf(t)]++;
  let best: Suit = 0;
  for (const s of [1, 2] as Suit[]) if (n[s] < n[best]) best = s;
  return best;
}

/** What happens when a player runs out of time. */
export function timeoutAction(state: GameState, seat: number): Action | null {
  const legal = legalActions(state, seat);
  const p = state.players[seat];
  if (legal.exchange) return { type: 'exchange', tiles: suggestExchange(p.hand) };
  if (legal.void) return { type: 'void', suit: suggestVoid(p.hand) };
  if (legal.claim || legal.rob) return { type: 'pass' };
  if (legal.discard) {
    const allowed = legal.discard;
    if (p.drawn !== null && allowed.includes(p.drawn)) return { type: 'discard', tile: p.drawn };
    return { type: 'discard', tile: allowed[allowed.length - 1] };
  }
  return null;
}

/** Every tile is somewhere: wall, hands, melds, discards. Used by invariant tests. */
export function tileCensus(state: GameState): number[] {
  const c = countsOf(state.wall);
  for (const p of state.players) {
    for (const t of p.hand) c[t]++;
    for (const t of p.discards) c[t]++;
    for (const m of p.melds) c[m.tile] += m.kind === 'pung' ? 3 : 4;
  }
  const step = state.step;
  if (step.kind === 'rob') c[step.tile]++;
  return c;
}
