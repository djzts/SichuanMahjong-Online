import { describe, expect, it } from 'vitest';
import { tileCensus } from '../src/engine/game';
import { newAIRoom, playHand } from './selfplay';

const HANDS = Number(process.env.SELFPLAY_HANDS ?? 1000);

describe(`AI self-play (${HANDS} hands)`, () => {
  it('finishes every hand, keeps 108 tiles and sums to zero', () => {
    let room = newAIRoom();
    let wins = 0;
    let draws = 0;
    for (let i = 0; i < HANDS; i++) {
      room = playHand(room, 1000 + i);
      const last = room.history[room.history.length - 1];
      expect(last.deltas.reduce((a: number, b) => a + (b ?? 0), 0)).toBe(0);
      expect(tileCensus(room.game!).every((n) => n === 4)).toBe(true);
      wins += last.winners.length;
      if (last.reason === 'wall-exhausted') draws++;
    }
    expect(room.totals.reduce((a, b) => a + b, 0)).toBe(0);
    // Sanity: the AI actually wins hands.
    expect(wins).toBeGreaterThan(HANDS);
    console.log(`self-play: ${HANDS} hands, ${wins} wins, ${draws} exhaustive draws`);
  });
});

describe.each([5, 6, 7] as const)('%i-player rotation self-play', (n) => {
  it('rotates the bench in every hand and keeps scores zero-sum', () => {
    let room = newAIRoom(undefined, n);
    const played = new Set<number>();
    for (let i = 0; i < 150; i++) {
      const prevBench = [...room.bench];
      room = playHand(room, 7000 + n * 1000 + i);
      const t = room.table;
      expect(new Set(t).size).toBe(4);
      expect(room.bench.length).toBe(n - 4);
      expect([...t, ...room.bench].sort()).toEqual(Array.from({ length: n }, (_, k) => k));
      // Everyone who sat out last hand played this one.
      if (i > 0) for (const m of prevBench) expect(t).toContain(m);
      t.forEach((m) => played.add(m));
      const rot = room.nextRotation!;
      expect(rot.out.length).toBe(n === 7 ? 3 : n - 4);
      expect(rot.in.map((x) => x.member).sort()).toEqual([...room.bench].sort());
      expect(rot.bench.length).toBe(n - 4);
      const d = room.history[room.history.length - 1].deltas;
      expect(d.filter((x) => x === null).length).toBe(n - 4);
    }
    expect(played.size).toBe(n);
    expect(room.totals.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
