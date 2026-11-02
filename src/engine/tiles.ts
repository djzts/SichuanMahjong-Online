/**
 * Tile representation.
 *
 * A tile is an integer 0..26: suit = floor(t / 9) (0 = 万, 1 = 条, 2 = 筒), rank = t % 9 + 1.
 * The physical set has 4 copies of each of the 27 tile kinds (108 tiles).
 */
export type Tile = number;
export type Suit = 0 | 1 | 2;

export const TILE_KINDS = 27;
export const SUITS: readonly Suit[] = [0, 1, 2];

export const suitOf = (t: Tile): Suit => Math.floor(t / 9) as Suit;
export const rankOf = (t: Tile): number => (t % 9) + 1;
export const makeTile = (suit: Suit, rank: number): Tile => suit * 9 + (rank - 1);

export function fullSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let t = 0; t < TILE_KINDS; t++) for (let k = 0; k < 4; k++) tiles.push(t);
  return tiles;
}

export function countsOf(tiles: readonly Tile[]): number[] {
  const c = new Array<number>(TILE_KINDS).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}

export function sortTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a - b);
}

export function countTile(tiles: readonly Tile[], t: Tile): number {
  let n = 0;
  for (const x of tiles) if (x === t) n++;
  return n;
}

/** Removes `n` copies of `t` from `tiles` (mutates). Throws if not enough copies. */
export function removeTiles(tiles: Tile[], t: Tile, n = 1): void {
  for (let i = 0; i < n; i++) {
    const idx = tiles.indexOf(t);
    if (idx < 0) throw new Error(`tile ${t} not in hand`);
    tiles.splice(idx, 1);
  }
}

const RANK_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const SUIT_CN = ['万', '条', '筒'] as const;

export function tileName(t: Tile): string {
  return RANK_CN[rankOf(t) - 1] + SUIT_CN[suitOf(t)];
}

/** Short code used in tests and logs, e.g. "5m" (万), "3s" (条), "7p" (筒). */
export function tileCode(t: Tile): string {
  return `${rankOf(t)}${'msp'[suitOf(t)]}`;
}

/** Parses "123m 456s 77p" style strings into tiles. */
export function parseTiles(s: string): Tile[] {
  const out: Tile[] = [];
  for (const group of s.trim().split(/\s+/)) {
    if (!group) continue;
    const suitChar = group[group.length - 1];
    const suit = 'msp'.indexOf(suitChar);
    if (suit < 0) throw new Error(`bad tile group ${group}`);
    for (const ch of group.slice(0, -1)) out.push(makeTile(suit as Suit, Number(ch)));
  }
  return out;
}
