import {
  applyAction,
  createGame,
  type Action,
  type ActionResult,
  type GameState,
} from '../src/engine/game';
import { makeRules, type Rules } from '../src/engine/rules';
import { parseTiles, type Suit } from '../src/engine/tiles';

export const T = parseTiles;
export const t1 = (s: string) => parseTiles(s)[0];

export function must(r: ActionResult): GameState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

export function act(g: GameState, seat: number, action: Action): GameState {
  return must(applyAction(g, seat, action));
}

/** Builds a hand already in the play phase (dealer to act). */
export function setupPlay(opts: {
  hands: string[];
  wall: string;
  voids?: Suit[];
  dealer?: number;
  rules?: Partial<Rules>;
}): GameState {
  const rules = makeRules({ exchangeThree: false, heavenEarthCap: false, ...opts.rules });
  let g = createGame({
    rules,
    seed: 1,
    dealer: opts.dealer ?? 0,
    preset: { hands: opts.hands.map(parseTiles), wall: parseTiles(opts.wall) },
  });
  const voids = opts.voids ?? [2, 2, 2, 2];
  for (let s = 0; s < 4; s++) g = act(g, s, { type: 'void', suit: voids[s] });
  return g;
}

export function deltasOf(g: GameState): number[] {
  const d = [0, 0, 0, 0];
  for (const s of g.settlements)
    for (const p of s.payments) {
      d[p.from] -= p.amount;
      d[p.to] += p.amount;
    }
  return d;
}
