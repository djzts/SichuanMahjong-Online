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
      expect(last.deltas.reduce((a, b) => a + b, 0)).toBe(0);
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
