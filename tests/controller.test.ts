import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRules } from '../src/engine/rules';
import { createRoom, setSeatAI, type PlayerCount } from '../src/engine/room';
import { RoomController } from '../src/net/controller';

function room(humans: string[], n: PlayerCount = 4) {
  let r = createRoom('111111', makeRules(), { playerId: 'host', name: '房主' }, n);
  r = {
    ...r,
    members: r.members.map((s, i) =>
      i > 0 && i <= humans.length
        ? { kind: 'human' as const, playerId: humans[i - 1], name: humans[i - 1], connected: true }
        : s,
    ),
  };
  for (let s = 1; s < n; s++) r = setSeatAI(r, s, true);
  return r;
}

describe('RoomController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finishes a hand on its own: AI seats move, the idle human times out', () => {
    const c = new RoomController(room([]), 'host', { aiDelayMs: [10, 10], seed: () => 99 });
    expect(c.start()).toBe(true);
    expect(c.viewFor('host')!.game!.deadlineMs).toBe(20_000);
    for (let i = 0; i < 400 && c.room.phase === 'playing'; i++) vi.advanceTimersByTime(21_000);
    expect(c.room.phase).toBe('handEnd');
    expect(c.room.totals.reduce((a, b) => a + b, 0)).toBe(0);
    c.dispose();
  });

  it('rejects game actions from spectators', () => {
    const c = new RoomController(room([]), 'host');
    const res = c.join({ playerId: 'spec', name: '观众', role: 'spectator' });
    expect(res).toMatchObject({ ok: true, role: 'spectator' });
    c.start();
    expect(c.intent('spec', { type: 'pass' })).toEqual({
      ok: false,
      error: 'spectators cannot act',
    });
    expect(c.viewFor('spec')!.game!.me).toBeNull();
    c.dispose();
  });

  it('a disconnected player is played by the AI until they come back', () => {
    const c = new RoomController(room(['p1']), 'host', { aiDelayMs: [10, 10] });
    c.start();
    // p1 is a human at seat 1: the exchange waits for them.
    vi.advanceTimersByTime(100);
    expect(c.room.game!.players[1].exchangePick).toBeNull();
    c.disconnect('p1');
    expect(c.room.members[1]!.connected).toBe(false);
    vi.advanceTimersByTime(100);
    expect(c.room.game!.players[1].exchangePick).not.toBeNull();
    c.join({ playerId: 'p1', name: 'p1', role: 'player' });
    expect(c.room.members[1]!.connected).toBe(true);
    c.dispose();
  });

  it('rejects game actions from a member who sits this hand out', () => {
    const humans = ['p1', 'p2', 'p3', 'p4'];
    const c = new RoomController(room(humans, 5), 'host', { aiDelayMs: [10, 10] });
    c.start();
    expect(c.room.bench).toEqual([4]);
    expect(c.intent('p4', { type: 'pass' })).toEqual({
      ok: false,
      error: 'not playing this hand',
    });
    expect(c.viewFor('p4')!.role).toBe('bench');
    expect(c.viewFor('p4')!.game!.me).toBeNull();
    c.dispose();
  });

  it('keeps the countdown while other players respond in the same step', () => {
    const c = new RoomController(room(['p1']), 'host', { aiDelayMs: [10, 10] });
    c.start();
    vi.advanceTimersByTime(5_000);
    c.intent('p1', { type: 'exchange', tiles: c.viewFor('p1')!.game!.me!.suggestedExchange! });
    expect(c.viewFor('host')!.game!.deadlineMs).toBe(15_000);
    c.dispose();
  });
});
