/**
 * Computer AI. Works only from a player's own view (the same data a human gets), so it can
 * never see other hands. Simple but sensible: void suit first, shanten + useful-tile count for
 * discards, always win, basic pung/kong judgement.
 */
import type { Action } from './game';
import { suggestExchange, suggestVoid } from './game';
import { shanten } from './hand';
import { countsOf, suitOf, TILE_KINDS, type Suit, type Tile } from './tiles';
import type { GameView, MyView } from './view';

function visibleCounts(view: GameView): number[] {
  const c = countsOf(view.me!.hand);
  for (const p of view.players) {
    for (const t of p.discards) c[t]++;
    for (const m of p.melds ?? []) if (m.tile !== null) c[m.tile] += m.kind === 'pung' ? 3 : 4;
    if (p.revealed) for (const t of p.revealed.hand) c[t]++;
    else if (p.winTile !== undefined) c[p.winTile]++;
  }
  return c.map((x) => Math.min(x, 4));
}

/** Suit the hand is drifting towards for 清一色, if any. */
function pureTarget(me: MyView): Suit | null {
  const n = [0, 0, 0];
  for (const t of me.hand) n[suitOf(t)]++;
  for (const m of me.melds) if (m.tile !== null) n[suitOf(m.tile)] += 3;
  if (me.voidSuit !== null) n[me.voidSuit] = 0;
  let best: Suit = 0;
  for (const s of [1, 2] as Suit[]) if (n[s] > n[best]) best = s;
  const total = n[0] + n[1] + n[2];
  return n[best] >= 10 && n[best] >= total - 3 ? best : null;
}

function usefulCount(counts: number[], meldCount: number, base: number, seen: number[]): number {
  let n = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    const left = 4 - seen[t];
    if (left <= 0) continue;
    counts[t]++;
    if (shanten(counts, meldCount) < base) n += left;
    counts[t]--;
  }
  return n;
}

/** Best discard among `allowed`. */
export function chooseDiscard(view: GameView, allowed: Tile[]): Tile {
  const me = view.me!;
  if (me.voidSuit !== null && allowed.every((t) => suitOf(t) === me.voidSuit)) {
    // Get rid of void tiles; singles before pairs.
    const c = countsOf(me.hand);
    return [...allowed].sort((a, b) => c[a] - c[b] || b - a)[0];
  }
  const counts = countsOf(me.hand);
  const meldCount = me.melds.length;
  const seen = visibleCounts(view);
  const target = pureTarget(me);
  let best: Tile = allowed[allowed.length - 1];
  let bestScore = Infinity;
  const scored: { t: Tile; sh: number }[] = [];
  for (const t of allowed) {
    counts[t]--;
    scored.push({ t, sh: shanten(counts, meldCount) });
    counts[t]++;
  }
  const minSh = Math.min(...scored.map((x) => x.sh));
  for (const { t, sh } of scored) {
    if (sh > minSh + (target !== null && suitOf(t) !== target ? 1 : 0)) continue;
    counts[t]--;
    const useful = usefulCount(counts, meldCount, sh, seen);
    counts[t]++;
    let score = sh * 1000 - useful * 10;
    if (target !== null && suitOf(t) !== target) score -= 600;
    const r = (t % 9) + 1;
    if (r === 1 || r === 9) score -= 2;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function bestShantenAfterDiscard(counts: number[], meldCount: number): number {
  let best = 99;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] === 0) continue;
    counts[t]--;
    best = Math.min(best, shanten(counts, meldCount));
    counts[t]++;
  }
  return best;
}

function shouldClaim(me: MyView, tile: Tile, kind: 'pung' | 'kong'): boolean {
  const target = pureTarget(me);
  if (target !== null && suitOf(tile) !== target) return false;
  const counts = countsOf(me.hand);
  const meldCount = me.melds.length;
  const before = shanten(counts, meldCount);
  if (kind === 'pung') {
    if (before === 0) return false; // ready: keep the wait
    counts[tile] -= 2;
    const after = bestShantenAfterDiscard(counts, meldCount + 1);
    return after < before;
  }
  counts[tile] -= 3;
  return shanten(counts, meldCount + 1) <= before;
}

function shouldSelfKong(me: MyView, tile: Tile): boolean {
  const counts = countsOf(me.hand);
  const meldCount = me.melds.length;
  const before = bestShantenAfterDiscard([...counts], meldCount);
  const concealed = counts[tile] === 4;
  counts[tile] -= concealed ? 4 : 1;
  return shanten(counts, concealed ? meldCount + 1 : meldCount) <= before;
}

export function aiDecide(view: GameView): Action | null {
  const me = view.me;
  if (!me) return null;
  const legal = me.legal;
  if (legal.exchange) return { type: 'exchange', tiles: suggestExchange(me.hand) };
  if (legal.void) return { type: 'void', suit: suggestVoid(me.hand) };
  if (legal.rob) return { type: 'hu' };
  if (legal.claim) {
    const c = legal.claim;
    if (c.hu) return { type: 'hu' };
    if (c.kong && shouldClaim(me, c.tile, 'kong')) return { type: 'kong' };
    if (c.pung && shouldClaim(me, c.tile, 'pung')) return { type: 'pung' };
    return { type: 'pass' };
  }
  if (legal.selfHu) return { type: 'hu' };
  for (const t of legal.kongs ?? []) if (shouldSelfKong(me, t)) return { type: 'kong', tile: t };
  if (legal.discard && legal.discard.length) {
    return { type: 'discard', tile: chooseDiscard(view, legal.discard) };
  }
  return null;
}
