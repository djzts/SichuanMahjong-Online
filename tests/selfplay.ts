import { aiDecide } from '../src/engine/ai';
import { pendingSeats, tileCensus } from '../src/engine/game';
import { makeRules, type Rules } from '../src/engine/rules';
import {
  applyRoomAction,
  createRoom,
  fillWithAI,
  startHand,
  type RoomState,
} from '../src/engine/room';
import { viewFor } from '../src/engine/view';

export function newAIRoom(rules: Rules = makeRules()): RoomState {
  return fillWithAI(createRoom('123456', rules, { playerId: 'host', name: '房主' }));
}

/** Plays one hand with 4 AIs. `onStep` sees every intermediate room state. */
export function playHand(
  room: RoomState,
  seed: number,
  onStep?: (room: RoomState) => void,
): RoomState {
  let r = startHand(room, seed);
  let guard = 0;
  while (r.phase === 'playing') {
    if (++guard > 2000) throw new Error(`hand did not finish (seed ${seed})`);
    const game = r.game!;
    const census = tileCensus(game);
    if (!census.every((n) => n === 4)) throw new Error(`tile census broken (seed ${seed})`);
    onStep?.(r);
    const pending = pendingSeats(game);
    if (pending.length === 0) throw new Error(`nobody to act (seed ${seed}, ${game.step.kind})`);
    const seat = pending[0];
    const view = viewFor(r, { kind: 'player', seat }).game!;
    const action = aiDecide(view);
    if (!action) throw new Error(`AI had no action (seed ${seed})`);
    const res = applyRoomAction(r, seat, action);
    if (!res.ok) throw new Error(`AI action rejected: ${res.error} (seed ${seed})`);
    r = res.room;
  }
  onStep?.(r);
  return r;
}
