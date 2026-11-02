/** Fan (番) calculation and scoring. Pure functions. */
import { isSevenPairs, standardDecompositions, waitingTiles } from './hand';
import type { FanTable, Rules } from './rules';
import { countsOf, rankOf, suitOf, TILE_KINDS, type Tile } from './tiles';
import { isKong, type Meld } from './types';

export interface WinContext {
  selfDraw: boolean;
  kongFlower?: boolean; // 杠上花
  kongDiscard?: boolean; // 杠上炮
  robKong?: boolean; // 抢杠胡
  lastTile?: boolean; // 海底 (海底捞月 if selfDraw, else 海底炮)
  heavenly?: boolean; // 天胡
  earthly?: boolean; // 地胡
}

export interface FanItem {
  key: keyof FanTable | 'tianhu' | 'dihu' | 'zimo';
  fan: number;
  count?: number;
}

export interface FanResult {
  /** Main hand pattern key, e.g. 'qingdui'. */
  pattern: keyof FanTable;
  items: FanItem[];
  roots: number;
  /** Fan before the cap. */
  rawFan: number;
  /** Fan after the cap. */
  fan: number;
  capped: boolean;
}

interface PatternResult {
  pattern: keyof FanTable;
  patternFan: number;
  roots: number;
  jingoudiao: boolean;
}

function countRoots(allCounts: readonly number[]): number {
  let r = 0;
  for (const x of allCounts) if (x === 4) r++;
  return r;
}

/** Counts of every tile the player holds: concealed (incl. winning tile) + melds. */
function ownedCounts(concealed: readonly Tile[], melds: readonly Meld[]): number[] {
  const c = countsOf(concealed);
  for (const m of melds) c[m.tile] += isKong(m) ? 4 : 3;
  return c;
}

function bestPattern(
  concealed: readonly Tile[],
  melds: readonly Meld[],
  table: FanTable,
): PatternResult | null {
  const counts = countsOf(concealed);
  const all = ownedCounts(concealed, melds);
  const suits = new Set<number>();
  for (let t = 0; t < TILE_KINDS; t++) if (all[t] > 0) suits.add(suitOf(t));
  const pure = suits.size === 1;
  const roots = countRoots(all);
  let best: PatternResult | null = null;
  const consider = (r: PatternResult) => {
    const total = r.patternFan + r.roots * table.gen + (r.jingoudiao ? table.jingoudiao : 0);
    const bestTotal = best
      ? best.patternFan + best.roots * table.gen + (best.jingoudiao ? table.jingoudiao : 0)
      : -1;
    if (total > bestTotal) best = r;
  };

  if (isSevenPairs(counts, melds.length)) {
    const quads = countRoots(counts);
    const dragon = quads > 0;
    const pattern: keyof FanTable = dragon
      ? pure
        ? 'qinglongqidui'
        : 'longqidui'
      : pure
        ? 'qingqidui'
        : 'qidui';
    consider({
      pattern,
      patternFan: table[pattern],
      roots: roots - (dragon ? 1 : 0),
      jingoudiao: false,
    });
  }

  const jingoudiao = concealed.length === 2;
  for (const d of standardDecompositions(counts, melds.length)) {
    const allPungs = d.sets.every((s) => s.kind === 'pung');
    const yaojiu =
      (rankOf(d.pair) === 1 || rankOf(d.pair) === 9) &&
      d.sets.every((s) =>
        s.kind === 'pung'
          ? rankOf(s.tile) === 1 || rankOf(s.tile) === 9
          : rankOf(s.tile) === 1 || rankOf(s.tile) === 7,
      ) &&
      melds.every((m) => rankOf(m.tile) === 1 || rankOf(m.tile) === 9);
    const is258 = (t: Tile) => [2, 5, 8].includes(rankOf(t));
    const jiang =
      allPungs &&
      is258(d.pair) &&
      d.sets.every((s) => is258(s.tile)) &&
      melds.every((m) => is258(m.tile));

    const candidates: (keyof FanTable)[] = ['pinghu'];
    if (allPungs) candidates.push('duiduihu');
    if (pure) candidates.push('qingyise');
    if (pure && allPungs) candidates.push('qingdui');
    if (yaojiu) candidates.push('daiyaojiu');
    if (jiang) candidates.push('jiangdui');
    let pattern: keyof FanTable = 'pinghu';
    for (const k of candidates) if (table[k] > table[pattern]) pattern = k;
    consider({ pattern, patternFan: table[pattern], roots, jingoudiao });
  }
  return best;
}

/**
 * Computes the fan of a winning hand.
 * @param concealed concealed tiles including the winning tile (3n+2 tiles)
 * Returns null if the hand is not a winning hand.
 */
export function calcFan(
  concealed: readonly Tile[],
  melds: readonly Meld[],
  ctx: WinContext,
  rules: Rules,
): FanResult | null {
  const table = rules.fan;
  const p = bestPattern(concealed, melds, table);
  if (!p) return null;
  const items: FanItem[] = [{ key: p.pattern, fan: p.patternFan }];
  if (p.jingoudiao) items.push({ key: 'jingoudiao', fan: table.jingoudiao });
  if (p.roots > 0) items.push({ key: 'gen', fan: p.roots * table.gen, count: p.roots });
  if (ctx.kongFlower) items.push({ key: 'gangshanghua', fan: table.gangshanghua });
  if (ctx.kongDiscard) items.push({ key: 'gangshangpao', fan: table.gangshangpao });
  if (ctx.robKong) items.push({ key: 'qiangganghu', fan: table.qiangganghu });
  if (ctx.lastTile)
    items.push(
      ctx.selfDraw
        ? { key: 'haidilaoyue', fan: table.haidilaoyue }
        : { key: 'haidipao', fan: table.haidipao },
    );
  if (ctx.selfDraw && rules.selfDrawBonus === 'fan') items.push({ key: 'zimo', fan: 1 });
  let rawFan = items.reduce((s, i) => s + i.fan, 0);
  if (rules.heavenEarthCap && (ctx.heavenly || ctx.earthly)) {
    items.unshift({ key: ctx.heavenly ? 'tianhu' : 'dihu', fan: rules.capFan });
    rawFan = Math.max(rawFan, rules.capFan);
  }
  const fan = Math.min(rawFan, rules.capFan);
  return { pattern: p.pattern, items, roots: p.roots, rawFan, fan, capped: rawFan > rules.capFan };
}

/** Amount each payer pays for a win. */
export function winAmount(fan: FanResult, selfDraw: boolean, rules: Rules): number {
  let amount = rules.baseScore * 2 ** fan.fan;
  if (selfDraw && rules.selfDrawBonus === 'base') amount += rules.baseScore;
  return amount;
}

export function capAmount(rules: Rules): number {
  return rules.baseScore * 2 ** rules.capFan;
}

/**
 * For 查大叫: the highest fan the hand could win with (roots included, no situational
 * bonuses, capped). Returns null when the hand is not ready.
 */
export function maxReadyFan(
  concealed: readonly Tile[],
  melds: readonly Meld[],
  rules: Rules,
): number | null {
  const owned = ownedCounts(concealed, melds);
  const waits = waitingTiles(countsOf(concealed), melds.length, owned);
  if (waits.length === 0) return null;
  let best = -1;
  for (const w of waits) {
    const r = calcFan([...concealed, w], melds, { selfDraw: false }, rules);
    if (r && r.fan > best) best = r.fan;
  }
  return best;
}

export const FAN_EXTRA_NAMES: Record<'tianhu' | 'dihu' | 'zimo', string> = {
  tianhu: '天胡',
  dihu: '地胡',
  zimo: '自摸加番',
};
