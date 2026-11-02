import { describe, expect, it } from 'vitest';
import type { GameState, Settlement } from '../src/engine/game';
import { computeRotation, type PlayerCount } from '../src/engine/room';

/** computeRotation only reads dealer, rng, winOrder and settlements. */
function fakeGame(settlements: Settlement[], winOrder: number[], dealer = 0): GameState {
  return { dealer, rng: 12345, settlements, winOrder } as unknown as GameState;
}
const dianpao = (seat: number, from: number, amount = 1): Settlement => ({
  kind: 'dianpao',
  seat,
  from,
  tile: 0,
  payments: [{ from, to: seat, amount }],
});
const zimo = (seat: number, amount = 2): Settlement => ({
  kind: 'zimo',
  seat,
  tile: 0,
  payments: [0, 1, 2, 3].filter((s) => s !== seat).map((from) => ({ from, to: seat, amount })),
});

/** Members 0..3 at the table, 4.. on the bench. */
function rot(n: PlayerCount, game: GameState) {
  const table = [10, 11, 12, 13];
  const bench = [20, 21, 22].slice(0, n - 4);
  return computeRotation(n, table, bench, game)!;
}

describe('computeRotation', () => {
  it('4 players: nobody rotates', () => {
    expect(computeRotation(4, [0, 1, 2, 3], [], fakeGame([dianpao(1, 0)], [1]))).toBeNull();
  });

  describe('5 players', () => {
    it('the first discarder sits out; the bench player takes that seat', () => {
      const r = rot(5, fakeGame([dianpao(1, 2), zimo(3)], [1, 3]));
      expect(r.out).toEqual([{ member: 12, seat: 2, reason: 'dianpao' }]);
      expect(r.in).toEqual([{ member: 20, seat: 2 }]);
      expect(r.table).toEqual([10, 11, 20, 13]);
      expect(r.bench).toEqual([12]);
    });

    it('first win is a self-draw: the self-drawer’s opposite sits out', () => {
      const r = rot(5, fakeGame([zimo(1), dianpao(3, 0)], [1, 3]));
      expect(r.out).toEqual([{ member: 13, seat: 3, reason: 'zimo-opposite' }]);
      expect(r.table).toEqual([10, 11, 12, 20]);
    });

    it('robbing a kong counts like dealing in', () => {
      const robbed: Settlement = { ...dianpao(0, 3), kind: 'qianggang' };
      expect(rot(5, fakeGame([robbed], [0])).out[0]).toMatchObject({ seat: 3, reason: 'dianpao' });
    });

    it('exhaustive draw with no winner: the biggest loser sits out', () => {
      const huazhu: Settlement = {
        kind: 'huazhu',
        seat: 2,
        payments: [0, 1, 3].map((to) => ({ from: 2, to, amount: 8 })),
      };
      expect(rot(5, fakeGame([huazhu], [])).out[0]).toMatchObject({
        seat: 2,
        reason: 'draw-loser',
      });
    });

    it('exhaustive draw with all zero: the dealer sits out', () => {
      expect(rot(5, fakeGame([], [], 3)).out[0]).toMatchObject({ seat: 3, reason: 'draw-loser' });
    });
  });

  describe('6 players', () => {
    it('first discarder + the last one who did not win sit out', () => {
      const r = rot(6, fakeGame([zimo(1), dianpao(3, 2), dianpao(2, 0)], [1, 3, 2]));
      // First win is 1's self-draw → opposite (3) sits out; 0 never won.
      expect(r.out).toEqual([
        { member: 13, seat: 3, reason: 'zimo-opposite' },
        { member: 10, seat: 0, reason: 'last-standing' },
      ]);
      expect(r.in.map((x) => x.seat)).toEqual([0, 3]);
      expect(r.in.map((x) => x.member).sort()).toEqual([20, 21]);
      expect(r.bench).toEqual([13, 10]);
    });

    it('when both rules point at the same player, the next biggest loser goes too', () => {
      // 0 deals in first and is also the only one left without a win.
      const r = rot(6, fakeGame([dianpao(1, 0), dianpao(2, 3, 4), dianpao(3, 1)], [1, 2, 3]));
      expect(r.out[0]).toMatchObject({ seat: 0, reason: 'dianpao' });
      // Deltas: 0:-1, 1:+1-1=0, 2:+4, 3:-4+1=-3 → seat 3 lost the most among the rest.
      expect(r.out[1]).toMatchObject({ seat: 3, reason: 'fallback' });
    });
  });

  describe('7 players', () => {
    it('only the first winner stays; the 3 bench players fill the other seats', () => {
      const r = rot(7, fakeGame([dianpao(2, 1), zimo(0)], [2, 0]));
      expect(r.stayer).toEqual({ member: 12, reason: 'first-winner' });
      expect(r.out.map((o) => o.seat).sort()).toEqual([0, 1, 3]);
      expect(r.table[2]).toBe(12);
      expect([r.table[0], r.table[1], r.table[3]].sort()).toEqual([20, 21, 22]);
      expect(r.bench.sort()).toEqual([10, 11, 13]);
    });

    it('nobody won: the biggest winner of the hand stays', () => {
      const dajiao: Settlement = {
        kind: 'dajiao',
        seat: 0,
        payments: [{ from: 0, to: 3, amount: 2 }],
      };
      expect(rot(7, fakeGame([dajiao], [])).stayer).toEqual({
        member: 13,
        reason: 'draw-winner',
      });
    });
  });
});
