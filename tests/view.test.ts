import { describe, expect, it } from 'vitest';
import { applyRoomAction, joinRoom, startHand, type RoomState } from '../src/engine/room';
import { makeRules } from '../src/engine/rules';
import { viewFor, type ClientView } from '../src/engine/view';
import { newAIRoom, playHand } from './selfplay';

/** Keys that would carry tile information beyond the discard piles. */
const FORBIDDEN = [
  'hand',
  'melds',
  'revealed',
  'debugHand',
  'exchangePick',
  'tile',
  'claimTile',
  'voidSuit',
  'handCount',
  'fan',
  'meldKind',
  'suggestedExchange',
  'suggestedVoid',
];
/** Arrays of numbers that are not tiles. */
const NUMERIC_OK = new Set(['deltas', 'waiting', 'handDeltas']);

function walk(v: unknown, path: string[], out: { path: string; value: unknown }[]) {
  if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, [...path, String(i)], out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push({ path: [...path, k].join('.'), value: x });
      walk(x, [...path, k], out);
    }
  }
}

function checkSpectatorView(
  view: ClientView,
  room: RoomState,
  role: 'spectator' | 'bench' = 'spectator',
) {
  expect(view.role).toBe(role);
  const json = JSON.parse(JSON.stringify(view));
  const entries: { path: string; value: unknown }[] = [];
  walk(json, [], entries);
  for (const { path, value } of entries) {
    const key = path.split('.').pop()!;
    if (FORBIDDEN.includes(key)) {
      // `me` must be null and nothing tile-bearing may appear at all.
      throw new Error(`spectator view leaks "${path}" = ${JSON.stringify(value)}`);
    }
    if (Array.isArray(value) && value.some((x) => typeof x === 'number')) {
      const ok = key === 'discards' || NUMERIC_OK.has(key);
      if (!ok) throw new Error(`unexpected numeric array at ${path}`);
    }
  }
  expect(json.game?.me ?? null).toBeNull();
  if (room.game) {
    const shownTiles = (json.game.players as { discards: number[] }[]).reduce(
      (n, p) => n + p.discards.length,
      0,
    );
    const riverTiles = room.game.players.reduce((n, p) => n + p.discards.length, 0);
    expect(shownTiles).toBe(riverTiles);
  }
}

describe('viewFor', () => {
  it('spectators only ever see the discard piles (checked at every step of 30 hands)', () => {
    let room = newAIRoom();
    for (let i = 0; i < 30; i++) {
      room = playHand(room, 500 + i, (r) => {
        checkSpectatorView(viewFor(r, { kind: 'spectator' }), r);
      });
    }
  });

  it('temporary observers (临时观察者) also see only the discard piles', () => {
    let room = newAIRoom(undefined, 6);
    for (let i = 0; i < 6; i++) {
      room = playHand(room, 900 + i, (r) => {
        if (r.phase === 'lobby') return;
        for (const m of r.bench) {
          const v = viewFor(r, { kind: 'member', member: m });
          checkSpectatorView(v, r, 'bench');
          expect(v.myMember).toBe(m);
          expect(v.members[m].status).toBe('bench');
        }
      });
    }
  });

  it('the scoreboard shows live totals for every member', () => {
    const room = newAIRoom(undefined, 5);
    let sawLive = false;
    playHand(room, 31, (r) => {
      const v = viewFor(r, { kind: 'spectator' });
      expect(v.members.length).toBe(5);
      const sum = v.members.reduce((a, m) => a + m.total, 0);
      expect(sum).toBe(0);
      if (r.phase === 'playing' && v.members.some((m) => m.handDelta)) sawLive = true;
    });
    expect(sawLive).toBe(true);
  });

  it('players see only their own hand', () => {
    playHand(newAIRoom(), 77, (r) => {
      for (let seat = 0; seat < 4; seat++) {
        const v = viewFor(r, { kind: 'member', member: r.table[seat] });
        const g = r.game!;
        expect(v.game!.me!.hand).toEqual(g.players[seat].hand);
        v.game!.players.forEach((p, s) => {
          expect(p).not.toHaveProperty('debugHand');
          expect(p).not.toHaveProperty('hand');
          if (s !== seat && !g.players[s].won && g.step.kind !== 'ended')
            expect(p).not.toHaveProperty('revealed');
          if (g.step.kind === 'void' && s !== seat) expect(p).not.toHaveProperty('voidSuit');
          for (const m of p.melds ?? [])
            if (m.kind === 'kong-concealed' && s !== seat && !g.players[s].won)
              expect(m.tile).toBeNull();
        });
        if (g.step.kind === 'exchange') {
          const others = JSON.stringify(v.game!.players);
          expect(others).not.toContain('exchangePick');
        }
      }
    });
  });

  it('spectator visibility switches add melds / void suits / hand counts', () => {
    const rules = makeRules({
      spectator: {
        slots: 2,
        visible: { melds: true, voidSuit: true, handCount: true, fanDetail: true },
      },
    });
    let sawVoid = false;
    playHand(newAIRoom(rules), 9, (r) => {
      const v = viewFor(r, { kind: 'spectator' });
      const p = v.game!.players[0];
      expect(p).toHaveProperty('melds');
      expect(p).toHaveProperty('handCount');
      expect(p).not.toHaveProperty('revealed');
      if (p.voidSuit !== undefined && p.voidSuit !== null) sawVoid = true;
    });
    expect(sawVoid).toBe(true);
  });
});

describe('spectator slots and actions', () => {
  it('fills 2 spectator slots, then reports the room as full', () => {
    let room = newAIRoom();
    const a = joinRoom(room, { playerId: 'a', name: '甲', role: 'player' });
    expect(a).toMatchObject({ ok: true, role: 'spectator', note: 'seats-full' });
    room = (a as { room: RoomState }).room;
    const b = joinRoom(room, { playerId: 'b', name: '乙', role: 'spectator' });
    expect(b.ok).toBe(true);
    room = (b as { room: RoomState }).room;
    expect(joinRoom(room, { playerId: 'c', name: '丙', role: 'spectator' })).toEqual({
      ok: false,
      reason: 'full',
    });
    // A known spectator reconnects to the same slot.
    expect(joinRoom(room, { playerId: 'a', name: '甲', role: 'spectator' })).toMatchObject({
      ok: true,
      role: 'spectator',
    });
  });

  it('the room rejects actions for a seat that does not exist', () => {
    const room = startHand(newAIRoom(), 3);
    expect(applyRoomAction(room, -1, { type: 'pass' }).ok).toBe(false);
  });
});
