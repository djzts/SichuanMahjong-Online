/**
 * Tile faces drawn as inline SVG (no external or copyrighted artwork).
 * viewBox is 60 × 80. 万 = numeral + 万, 条 = bamboo sticks, 筒 = circles.
 */
import { rankOf, suitOf, type Tile } from '../engine/tiles';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const RED = '#c62828';
const GREEN = '#1b7a3a';
const BLUE = '#1f4e9c';

type P = [number, number];

const DOTS: Record<number, { pts: P[]; r: number }> = {
  1: { pts: [[30, 40]], r: 21 },
  2: {
    pts: [
      [30, 21],
      [30, 59],
    ],
    r: 13,
  },
  3: {
    pts: [
      [15, 16],
      [30, 40],
      [45, 64],
    ],
    r: 10.5,
  },
  4: {
    pts: [
      [18, 24],
      [42, 24],
      [18, 56],
      [42, 56],
    ],
    r: 11,
  },
  5: {
    pts: [
      [16, 18],
      [44, 18],
      [30, 40],
      [16, 62],
      [44, 62],
    ],
    r: 9.5,
  },
  6: {
    pts: [
      [19, 15],
      [41, 15],
      [19, 40],
      [41, 40],
      [19, 65],
      [41, 65],
    ],
    r: 9,
  },
  7: {
    pts: [
      [14, 12],
      [30, 21],
      [46, 30],
      [19, 50],
      [41, 50],
      [19, 68],
      [41, 68],
    ],
    r: 7.8,
  },
  8: {
    pts: [
      [19, 11],
      [41, 11],
      [19, 30.5],
      [41, 30.5],
      [19, 49.5],
      [41, 49.5],
      [19, 69],
      [41, 69],
    ],
    r: 8.2,
  },
  9: {
    pts: [
      [14, 15],
      [30, 15],
      [46, 15],
      [14, 40],
      [30, 40],
      [46, 40],
      [14, 65],
      [30, 65],
      [46, 65],
    ],
    r: 8.2,
  },
};

function dotColor(rank: number, i: number): string {
  if (rank === 1) return RED;
  if (rank === 2) return [GREEN, BLUE][i];
  if (rank === 3) return [BLUE, RED, GREEN][i];
  if (rank === 4) return [BLUE, GREEN, GREEN, BLUE][i];
  if (rank === 5) return i === 2 ? RED : [BLUE, GREEN, GREEN, BLUE][i > 2 ? i - 1 : i];
  if (rank === 6) return i < 2 ? GREEN : RED;
  if (rank === 7) return i < 3 ? GREEN : RED;
  if (rank === 8) return BLUE;
  return [BLUE, BLUE, BLUE, RED, RED, RED, GREEN, GREEN, GREEN][i];
}

function circle([x, y]: P, r: number, color: string): string {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${color}" stroke-width="${r * 0.28}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="${color}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.16}" fill="#fff"/>`
  );
}

function dots(rank: number): string {
  const { pts, r } = DOTS[rank];
  if (rank === 1) {
    return (
      `<circle cx="30" cy="40" r="22" fill="#fff" stroke="${GREEN}" stroke-width="3"/>` +
      `<circle cx="30" cy="40" r="15" fill="none" stroke="${BLUE}" stroke-width="3" stroke-dasharray="4 2.5"/>` +
      `<circle cx="30" cy="40" r="9" fill="${RED}"/>` +
      `<circle cx="30" cy="40" r="3.5" fill="#fff"/>`
    );
  }
  return pts.map((p, i) => circle(p, r, dotColor(rank, i))).join('');
}

function stick(x: number, y: number, h: number, color: string, w = 6.5): string {
  const top = y - h / 2;
  return (
    `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="${w / 2}" fill="${color}"/>` +
    `<rect x="${x - w / 2 - 0.6}" y="${y - 1}" width="${w + 1.2}" height="2" fill="#fff" opacity=".85"/>` +
    `<line x1="${x}" y1="${top + 2}" x2="${x}" y2="${top + h - 2}" stroke="#fff" stroke-width="1" opacity=".45"/>`
  );
}

const STICKS: Record<number, { pts: P[]; h: number; red?: number[] }> = {
  2: {
    pts: [
      [30, 22],
      [30, 58],
    ],
    h: 26,
  },
  3: {
    pts: [
      [30, 22],
      [18, 58],
      [42, 58],
    ],
    h: 26,
  },
  4: {
    pts: [
      [19, 22],
      [41, 22],
      [19, 58],
      [41, 58],
    ],
    h: 26,
  },
  5: {
    pts: [
      [14, 22],
      [46, 22],
      [30, 40],
      [14, 58],
      [46, 58],
    ],
    h: 24,
    red: [2],
  },
  6: {
    pts: [
      [14, 22],
      [30, 22],
      [46, 22],
      [14, 58],
      [30, 58],
      [46, 58],
    ],
    h: 26,
  },
  7: {
    pts: [
      [30, 13],
      [14, 42],
      [30, 42],
      [46, 42],
      [14, 66],
      [30, 66],
      [46, 66],
    ],
    h: 18,
    red: [0],
  },
  8: {
    pts: [
      [11, 22],
      [23.7, 22],
      [36.3, 22],
      [49, 22],
      [11, 58],
      [23.7, 58],
      [36.3, 58],
      [49, 58],
    ],
    h: 26,
  },
  9: {
    pts: [
      [14, 14],
      [30, 14],
      [46, 14],
      [14, 40],
      [30, 40],
      [46, 40],
      [14, 66],
      [30, 66],
      [46, 66],
    ],
    h: 19,
    red: [1, 4, 7],
  },
};

function bamboo(rank: number): string {
  if (rank === 1) {
    // A stylised bird standing on a bamboo stalk.
    return (
      `<path d="M30 70 L30 46" stroke="${GREEN}" stroke-width="5" stroke-linecap="round"/>` +
      `<ellipse cx="30" cy="36" rx="14" ry="11" fill="${GREEN}"/>` +
      `<path d="M18 34 Q8 22 14 12 Q20 22 26 28 Z" fill="${BLUE}"/>` +
      `<path d="M42 34 Q52 22 46 12 Q40 22 34 28 Z" fill="${BLUE}"/>` +
      `<circle cx="30" cy="22" r="7" fill="${RED}"/>` +
      `<circle cx="32" cy="21" r="1.8" fill="#fff"/>` +
      `<path d="M36 22 L43 20 L36 25 Z" fill="#e0a100"/>` +
      `<path d="M22 70 L38 70" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>`
    );
  }
  const { pts, h, red = [] } = STICKS[rank];
  return pts.map(([x, y], i) => stick(x, y, h, red.includes(i) ? RED : GREEN)).join('');
}

function characters(rank: number): string {
  return (
    `<text x="30" y="34" text-anchor="middle" font-size="27" font-weight="700" fill="#1d2433" ` +
    `font-family="'Noto Serif SC','Songti SC','SimSun',serif">${NUMERALS[rank - 1]}</text>` +
    `<text x="30" y="70" text-anchor="middle" font-size="29" font-weight="700" fill="${RED}" ` +
    `font-family="'Noto Serif SC','Songti SC','SimSun',serif">萬</text>`
  );
}

const cache = new Map<Tile, string>();

export function tileFaceSvg(t: Tile): string {
  let svg = cache.get(t);
  if (!svg) {
    const rank = rankOf(t);
    const body = suitOf(t) === 0 ? characters(rank) : suitOf(t) === 1 ? bamboo(rank) : dots(rank);
    svg = `<svg viewBox="0 0 60 80" aria-hidden="true" focusable="false">${body}</svg>`;
    cache.set(t, svg);
  }
  return svg;
}

/** Small suit icon for void-suit markers etc. */
export function suitIcon(suit: number): string {
  return ['万', '条', '筒'][suit];
}
