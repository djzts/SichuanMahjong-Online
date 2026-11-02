/**
 * Hand analysis: win detection, decompositions, waits and shanten.
 * All functions are pure and work on a 27-length counts array of the concealed tiles.
 */
import { TILE_KINDS, type Tile } from './tiles';

export interface SetGroup {
  kind: 'pung' | 'chow';
  /** For a chow, the lowest tile. */
  tile: Tile;
}

export interface Decomposition {
  pair: Tile;
  sets: SetGroup[];
}

function sum(c: readonly number[]): number {
  let s = 0;
  for (const x of c) s += x;
  return s;
}

function canFormSets(c: number[], start: number): boolean {
  let i = start;
  while (i < TILE_KINDS && c[i] === 0) i++;
  if (i === TILE_KINDS) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = canFormSets(c, i);
    c[i] += 3;
    if (ok) return true;
  }
  if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    const ok = canFormSets(c, i);
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 4 sets + 1 pair, where `meldCount` sets are already exposed. */
export function isStandardWin(counts: readonly number[], meldCount: number): boolean {
  const setsNeeded = 4 - meldCount;
  if (sum(counts) !== setsNeeded * 3 + 2) return false;
  const c = [...counts];
  for (let p = 0; p < TILE_KINDS; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok = canFormSets(c, 0);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}

/** Seven pairs; four identical tiles count as two pairs (龙七对). Only with no exposed melds. */
export function isSevenPairs(counts: readonly number[], meldCount: number): boolean {
  if (meldCount !== 0 || sum(counts) !== 14) return false;
  return counts.every((x) => x % 2 === 0);
}

export function isWinningCounts(counts: readonly number[], meldCount: number): boolean {
  return isSevenPairs(counts, meldCount) || isStandardWin(counts, meldCount);
}

function collectSets(
  c: number[],
  start: number,
  acc: SetGroup[],
  pair: Tile,
  out: Decomposition[],
): void {
  let i = start;
  while (i < TILE_KINDS && c[i] === 0) i++;
  if (i === TILE_KINDS) {
    out.push({ pair, sets: [...acc] });
    return;
  }
  if (c[i] >= 3) {
    c[i] -= 3;
    acc.push({ kind: 'pung', tile: i });
    collectSets(c, i, acc, pair, out);
    acc.pop();
    c[i] += 3;
  }
  if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    acc.push({ kind: 'chow', tile: i });
    collectSets(c, i, acc, pair, out);
    acc.pop();
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
  }
}

/** All ways to split the concealed tiles into sets + one pair. */
export function standardDecompositions(
  counts: readonly number[],
  meldCount: number,
): Decomposition[] {
  const setsNeeded = 4 - meldCount;
  if (sum(counts) !== setsNeeded * 3 + 2) return [];
  const c = [...counts];
  const out: Decomposition[] = [];
  for (let p = 0; p < TILE_KINDS; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    collectSets(c, 0, [], p, out);
    c[p] += 2;
  }
  return out;
}

/**
 * Tiles that would complete the hand. `owned` counts every copy the player already holds
 * (concealed + melds); a tile the player already has all four of cannot be waited on.
 */
export function waitingTiles(
  concealedCounts: readonly number[],
  meldCount: number,
  owned: readonly number[] = concealedCounts,
): Tile[] {
  const waits: Tile[] = [];
  const c = [...concealedCounts];
  for (let t = 0; t < TILE_KINDS; t++) {
    if (owned[t] >= 4) continue;
    c[t]++;
    if (isWinningCounts(c, meldCount)) waits.push(t);
    c[t]--;
  }
  return waits;
}

// ---------------------------------------------------------------------------
// Shanten (向听数). Used by the AI. Per-suit partial results are memoised.

type Opt = [m: number, t: number, p: number];
const suitMemo = new Map<number, Opt[]>();

function addOpt(list: Opt[], o: Opt): void {
  for (const x of list) if (x[0] >= o[0] && x[1] >= o[1] && x[2] >= o[2]) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    if (o[0] >= x[0] && o[1] >= x[1] && o[2] >= x[2]) list.splice(i, 1);
  }
  list.push(o);
}

function suitRec(c: number[], i: number, m: number, t: number, p: number, out: Opt[]): void {
  while (i < 9 && c[i] === 0) i++;
  if (i === 9) {
    addOpt(out, [m, t, p]);
    return;
  }
  if (c[i] >= 3) {
    c[i] -= 3;
    suitRec(c, i, m + 1, t, p, out);
    c[i] += 3;
  }
  if (i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    suitRec(c, i, m + 1, t, p, out);
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
  }
  if (c[i] >= 2) {
    c[i] -= 2;
    if (p === 0) suitRec(c, i, m, t, 1, out);
    suitRec(c, i, m, t + 1, p, out);
    c[i] += 2;
  }
  if (i <= 7 && c[i + 1] > 0) {
    c[i]--;
    c[i + 1]--;
    suitRec(c, i, m, t + 1, p, out);
    c[i]++;
    c[i + 1]++;
  }
  if (i <= 6 && c[i + 2] > 0) {
    c[i]--;
    c[i + 2]--;
    suitRec(c, i, m, t + 1, p, out);
    c[i]++;
    c[i + 2]++;
  }
  c[i]--;
  suitRec(c, i, m, t, p, out);
  c[i]++;
}

function suitOptions(counts: readonly number[], offset: number): Opt[] {
  let key = 0;
  for (let i = 8; i >= 0; i--) key = key * 5 + counts[offset + i];
  let opts = suitMemo.get(key);
  if (!opts) {
    opts = [];
    suitRec(counts.slice(offset, offset + 9), 0, 0, 0, 0, opts);
    suitMemo.set(key, opts);
  }
  return opts;
}

export function standardShanten(counts: readonly number[], meldCount: number): number {
  const s = 4 - meldCount;
  const a = suitOptions(counts, 0);
  const b = suitOptions(counts, 9);
  const c = suitOptions(counts, 18);
  let best = 8;
  for (const x of a)
    for (const y of b)
      for (const z of c) {
        const p = x[2] + y[2] + z[2];
        if (p > 1) continue;
        const m = Math.min(x[0] + y[0] + z[0], s);
        const t = Math.min(x[1] + y[1] + z[1], s - m);
        const v = 2 * s - 2 * m - t - p;
        if (v < best) best = v;
      }
  return best;
}

export function sevenPairsShanten(counts: readonly number[]): number {
  let pairs = 0;
  for (const x of counts) pairs += Math.floor(x / 2);
  return 6 - Math.min(pairs, 7);
}

export function shanten(counts: readonly number[], meldCount: number): number {
  const st = standardShanten(counts, meldCount);
  if (meldCount > 0) return st;
  return Math.min(st, sevenPairsShanten(counts));
}
