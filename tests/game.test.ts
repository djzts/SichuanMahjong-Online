import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  tileCensus,
  type GameState,
} from '../src/engine/game';
import { makeRules } from '../src/engine/rules';
import { nextDealer } from '../src/engine/room';
import { tileCode } from '../src/engine/tiles';
import { act, deltasOf, setupPlay, T, t1 } from './helpers';

const JUNK = '147m 258m 369m 147s 8s';

function codes(tiles: number[]) {
  return tiles.map(tileCode).join(' ');
}

describe('dealing and setup', () => {
  it('deals 14 to the dealer and 13 to others, 108 tiles in total', () => {
    const g = createGame({ rules: makeRules(), seed: 42, dealer: 2 });
    expect(g.players.map((p) => p.hand.length)).toEqual([13, 13, 14, 13]);
    expect(g.wall.length).toBe(108 - 53);
    expect(tileCensus(g).every((n) => n === 4)).toBe(true);
  });

  it('same seed → same deal', () => {
    const a = createGame({ rules: makeRules(), seed: 7, dealer: 0 });
    const b = createGame({ rules: makeRules(), seed: 7, dealer: 0 });
    expect(a.players.map((p) => p.hand)).toEqual(b.players.map((p) => p.hand));
    expect(a.wall).toEqual(b.wall);
  });
});

describe('换三张 and 定缺', () => {
  it('passes three same-suit tiles in the chosen direction', () => {
    let g = createGame({
      rules: makeRules(),
      seed: 1,
      dealer: 0,
      preset: {
        hands: [
          T('123m 456m 789m 11s 23s 9p'),
          T('123m 456m 789m 123s 5s'),
          T('111m 222m 333m 444s 6s'),
          T(JUNK),
        ],
        wall: T('5s 6s 7s'),
        exchangeDir: 'ccw',
      },
    });
    expect(applyAction(g, 0, { type: 'exchange', tiles: T('1m 1s 9p') }).ok).toBe(false);
    g = act(g, 0, { type: 'exchange', tiles: T('123m') });
    g = act(g, 1, { type: 'exchange', tiles: T('123s') });
    g = act(g, 2, { type: 'exchange', tiles: T('111m') });
    expect(g.step.kind).toBe('exchange');
    g = act(g, 3, { type: 'exchange', tiles: T('147m') });
    expect(g.step.kind).toBe('void');
    // ccw: seat s gives to seat s+1
    expect(codes(g.players[1].hand)).toBe(codes(T('112233456789m 5s')));
    expect(g.players[0].hand).toContain(t1('1m'));
    expect(g.players[0].hand.filter((t) => t === t1('7m')).length).toBe(2);
  });

  it('must discard void-suit tiles first', () => {
    const g = setupPlay({
      hands: [
        '123m 456m 789m 11s 23s 9p',
        '123m 456m 789m 123s 5s',
        '111m 222m 333m 444s 6s',
        JUNK,
      ],
      wall: '5s 6s',
    });
    expect(applyAction(g, 0, { type: 'discard', tile: t1('1m') }).ok).toBe(false);
    expect(applyAction(g, 0, { type: 'discard', tile: t1('9p') }).ok).toBe(true);
  });

  it('cannot win while holding void tiles, cannot pung the void suit', () => {
    let g = setupPlay({
      hands: ['123m 456m 789m 11s 235s', '123m 456m 789m 55s 99p', JUNK, '147m 258m 369m 99p 8s'],
      wall: '1s 2s',
      voids: [2, 2, 2, 0],
    });
    g = act(g, 0, { type: 'discard', tile: t1('5s') });
    expect(legalActions(g, 1).claim).toEqual({
      tile: t1('5s'),
      hu: false,
      pung: true,
      kong: false,
    });
    expect(act(g, 1, { type: 'pass' }).players[1].melds).toEqual([]);

    let h = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', '147m 258m 369m 99p 8s', JUNK, '147m 258m 369m 99p 8s'],
      wall: '1s 2s',
      voids: [2, 2, 2, 0],
    });
    h = act(h, 0, { type: 'discard', tile: t1('9p') });
    expect(h.step.kind).toBe('claim');
    expect(legalActions(h, 1).claim).toBeUndefined(); // seat 1 voids 筒
    expect(legalActions(h, 3).claim?.pung).toBe(true); // seat 3 voids 万
  });
});

describe('winning', () => {
  const base = () =>
    setupPlay({
      hands: [
        '123m 456m 789m 11s 23s 9p',
        '123m 456m 789m 123s 5s',
        '2222m 111m 333m 44s 6s',
        JUNK,
      ],
      wall: '5s 7s 8s 9s',
    });

  it('自摸: every other player pays, with one extra base', () => {
    let g = act(base(), 0, { type: 'discard', tile: t1('9p') });
    expect(g.step).toMatchObject({ kind: 'act', seat: 1, drew: true });
    g = act(g, 1, { type: 'hu' });
    expect(deltasOf(g)).toEqual([-2, 6, -2, -2]);
    expect(g.players[1].won?.selfDraw).toBe(true);
    expect(g.step).toMatchObject({ kind: 'act', seat: 2 });
  });

  it('血战: players who already won do not pay for later kongs', () => {
    let g = act(base(), 0, { type: 'discard', tile: t1('9p') });
    g = act(g, 1, { type: 'hu' });
    g = act(g, 2, { type: 'kong', tile: t1('2m') });
    const kong = g.settlements.find((s) => s.kind === 'kong')!;
    expect(kong.payments.map((p) => p.from).sort()).toEqual([0, 3]);
    expect(kong.payments.every((p) => p.amount === 2)).toBe(true);
  });

  it('点炮 + 一炮多响: the discarder pays each winner', () => {
    let g = setupPlay({
      hands: ['123m 456m 789m 11s 235s', '123m 456m 789m 123s 5s', '111m 222m 333m 444s 5s', JUNK],
      wall: '7s 8s 9s',
    });
    g = act(g, 0, { type: 'discard', tile: t1('5s') });
    g = act(g, 2, { type: 'hu' });
    expect(g.step.kind).toBe('claim');
    g = act(g, 1, { type: 'hu' });
    expect(g.winOrder).toEqual([1, 2]);
    expect(deltasOf(g)).toEqual([-3, 1, 2, 0]); // 平胡 1, 对对胡 2
    expect(g.players[0].discards).toEqual([]);
    expect(g.step).toMatchObject({ kind: 'act', seat: 3 });
    expect(nextDealer(g)).toBe(0); // multi-win: the discarder deals next
  });

  it('一炮多响 disabled: only the first player in turn order wins', () => {
    let g = setupPlay({
      hands: ['123m 456m 789m 11s 235s', '123m 456m 789m 123s 5s', '111m 222m 333m 444s 5s', JUNK],
      wall: '7s 8s 9s',
      rules: { multipleWinners: false },
    });
    g = act(g, 0, { type: 'discard', tile: t1('5s') });
    g = act(g, 1, { type: 'hu' });
    g = act(g, 2, { type: 'hu' });
    expect(g.winOrder).toEqual([1]);
    expect(nextDealer(g)).toBe(1);
  });

  it('过水不胡: after passing a win, no discard wins until the next draw', () => {
    let g = setupPlay({
      hands: ['123m 456m 789m 11s 235s', JUNK, '111m 222m 333m 444s 5s', '147m 258m 369m 147s 9s'],
      wall: '5s 7s 8s',
    });
    g = act(g, 0, { type: 'discard', tile: t1('5s') });
    g = act(g, 2, { type: 'pass' });
    expect(g.players[2].huLocked).toBe(true);
    expect(g.step).toMatchObject({ kind: 'act', seat: 1 });
    g = act(g, 1, { type: 'discard', tile: t1('5s') });
    // Seat 2 could win on 5s but is locked, so play moves on and seat 2 draws.
    expect(g.step).toMatchObject({ kind: 'act', seat: 2 });
    expect(g.players[2].huLocked).toBe(false);
  });

  it('天胡 and 地胡 score the cap', () => {
    let g = setupPlay({
      hands: ['123m 456m 789m 234s 55s', JUNK, JUNK, JUNK],
      wall: '7s 8s',
      rules: { heavenEarthCap: true },
    });
    g = act(g, 0, { type: 'hu' });
    expect(g.players[0].won!.fan.items[0].key).toBe('tianhu');
    expect(deltasOf(g)).toEqual([51, -17, -17, -17]); // 16 (cap) + 1 self-draw base each

    let h = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', '123m 456m 789m 123s 5s', JUNK, JUNK],
      wall: '5s 8s',
      rules: { heavenEarthCap: true },
    });
    h = act(h, 0, { type: 'discard', tile: t1('9p') });
    h = act(h, 1, { type: 'hu' });
    expect(h.players[1].won!.fan.items[0].key).toBe('dihu');
  });

  it('海底捞月 on the last tile', () => {
    let g = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', '123m 456m 789m 123s 5s', JUNK, JUNK],
      wall: '5s',
    });
    g = act(g, 0, { type: 'discard', tile: t1('9p') });
    g = act(g, 1, { type: 'hu' });
    expect(g.players[1].won!.fan.items.map((i) => i.key)).toContain('haidilaoyue');
    // Wall is empty: the hand ends at the next draw with an exhaustive-draw settlement.
    expect(g.step).toMatchObject({ kind: 'ended', reason: 'wall-exhausted' });
  });
});

describe('pung and kong', () => {
  const claimSetup = (s1: string, s2: string, s3: string = JUNK) =>
    act(setupPlay({ hands: ['123m 456m 789m 11s 235s', s1, s2, s3], wall: '7s 8s 9s 1s' }), 0, {
      type: 'discard',
      tile: t1('5s'),
    });

  it('hu beats pung; the pung waits for the win decision', () => {
    let g = claimSetup('123m 456m 789m 123s 5s', '111m 222m 333m 55s 47s');
    g = act(g, 2, { type: 'pung' });
    expect(g.step.kind).toBe('claim');
    g = act(g, 1, { type: 'hu' });
    expect(g.winOrder).toEqual([1]);
    expect(g.players[2].melds).toEqual([]);
  });

  it('pung after the winner passes', () => {
    let g = claimSetup('123m 456m 789m 123s 5s', '111m 222m 333m 55s 47s');
    g = act(g, 2, { type: 'pung' });
    g = act(g, 1, { type: 'pass' });
    expect(g.players[2].melds).toEqual([{ kind: 'pung', tile: t1('5s'), from: 0 }]);
    expect(g.players[2].hand.length).toBe(11);
    expect(g.players[0].discards).toEqual([]);
    expect(g.step).toMatchObject({ kind: 'act', seat: 2, drew: false });
    expect(legalActions(g, 2).selfHu).toBe(false);
  });

  it('exposed kong: discarder pays 2, replacement comes from the wall tail', () => {
    let g = claimSetup(JUNK, JUNK, '555s 147m 258m 369m 1s');
    expect(legalActions(g, 3).claim).toMatchObject({ pung: true, kong: true });
    g = act(g, 3, { type: 'kong' });
    expect(g.players[3].melds[0]).toMatchObject({ kind: 'kong-exposed' });
    expect(g.players[3].drawn).toBe(t1('1s'));
    expect(g.step).toMatchObject({ kind: 'act', seat: 3, afterKong: true });
    expect(deltasOf(g)).toEqual([-2, 0, 0, 2]);
  });

  it('concealed kong: others pay 2 each; 杠上花 adds a fan', () => {
    let g = setupPlay({
      hands: ['1111m 456m 789m 11s 23s', JUNK, JUNK, JUNK],
      wall: '7s 8s 4s',
    });
    g = act(g, 0, { type: 'kong', tile: t1('1m') });
    expect(deltasOf(g)).toEqual([6, -2, -2, -2]);
    expect(g.players[0].drawn).toBe(t1('4s'));
    g = act(g, 0, { type: 'hu' });
    const keys = g.players[0].won!.fan.items.map((i) => i.key);
    expect(keys).toEqual(['pinghu', 'gen', 'gangshanghua']);
    expect(deltasOf(g)).toEqual([21, -7, -7, -7]);
  });

  it('杠上炮 + 呼叫转移: the kong money goes to the winner', () => {
    let g = setupPlay({
      hands: ['1111m 456m 789m 11s 23s', '123m 456m 789m 123s 9s', JUNK, JUNK],
      wall: '7s 8s 9s',
    });
    g = act(g, 0, { type: 'kong', tile: t1('1m') });
    g = act(g, 0, { type: 'discard', tile: t1('9s') });
    g = act(g, 1, { type: 'hu' });
    expect(g.players[1].won!.fan.items.map((i) => i.key)).toContain('gangshangpao');
    expect(g.settlements.map((s) => s.kind)).toEqual(['kong', 'dianpao', 'transfer']);
    expect(deltasOf(g)).toEqual([-2, 6, -2, -2]);
    expect(g.players[0].kongIncome).toEqual([]);
  });

  const robSetup = (s1: string) => {
    const g: GameState = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', s1, JUNK, JUNK],
      wall: '7s 8s 9s 1s',
    });
    const p0 = g.players[0];
    p0.hand = T('5s 123m 456m 789m 9s');
    p0.melds = [{ kind: 'pung', tile: t1('5s'), from: 2 }];
    // The 4th 5s was drawn this turn, so adding it now gets paid.
    p0.drawn = t1('5s');
    p0.turnDraws = [t1('5s')];
    return g;
  };

  it('抢杠胡: the added kong does not stand and collects nothing', () => {
    let g = robSetup('123m 456m 789m 123s 5s');
    g = act(g, 0, { type: 'kong', tile: t1('5s') });
    expect(g.step.kind).toBe('rob');
    g = act(g, 1, { type: 'hu' });
    expect(g.players[1].won!.fan.items.map((i) => i.key)).toContain('qiangganghu');
    expect(g.players[0].melds[0].kind).toBe('pung');
    expect(g.settlements.map((s) => s.kind)).toEqual(['qianggang']);
    expect(deltasOf(g)).toEqual([-2, 2, 0, 0]);
    expect(g.step).toMatchObject({ kind: 'act', seat: 2 });
  });

  it('added kong without a robber: every other player pays 1', () => {
    let g = robSetup(JUNK);
    g = act(g, 0, { type: 'kong', tile: t1('5s') });
    expect(g.players[0].melds[0].kind).toBe('kong-added');
    expect(deltasOf(g)).toEqual([3, -1, -1, -1]);
    expect(g.step).toMatchObject({ kind: 'act', seat: 0, afterKong: true });
  });
});

describe('exhaustive draw (流局)', () => {
  it('查花猪, 查大叫 and 退税', () => {
    let g = setupPlay({
      hands: [
        '123m 456m 789m 11s 23s 9s',
        JUNK,
        '111m 222m 333m 44s 99p',
        '123m 456m 789m 123s 5s',
      ],
      wall: '9s 5s',
    });
    const kongPays = [0, 2, 3].map((from) => ({ from, to: 1, amount: 2 }));
    g.settlements.push({ kind: 'kong', seat: 1, payments: kongPays });
    g.players[1].kongIncome = [...kongPays];

    g = act(g, 0, { type: 'discard', tile: t1('9s') });
    g = act(g, 1, { type: 'discard', tile: t1('9s') });
    g = act(g, 2, { type: 'discard', tile: t1('9p') });
    expect(g.step).toMatchObject({ kind: 'ended', reason: 'wall-exhausted' });
    const kinds = g.settlements.map((s) => s.kind);
    expect(kinds).toEqual(['kong', 'huazhu', 'dajiao', 'refund']);
    const huazhu = g.settlements[1];
    expect(huazhu.seat).toBe(2);
    expect(huazhu.payments.map((p) => [p.to, p.amount])).toEqual([
      [0, 16],
      [1, 16],
      [3, 16],
    ]);
    expect(g.settlements[2].payments.map((p) => [p.from, p.to, p.amount])).toEqual([
      [1, 0, 1],
      [1, 3, 1],
    ]);
    expect(g.settlements[3].payments.map((p) => [p.from, p.to, p.amount])).toEqual([
      [1, 0, 2],
      [1, 2, 2],
      [1, 3, 2],
    ]);
    const d = deltasOf(g);
    expect(d).toEqual([17, 14, -48, 17]);
    expect(d.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('added kongs that count but collect nothing', () => {
  it('先碰后杠: punged while holding a concealed triplet, konged later → no payment', () => {
    // Seat 3 holds 555s; seat 0 discards the 4th 5s; seat 3 pungs instead of konging.
    let g = setupPlay({
      hands: ['123m 456m 789m 11s 235s', JUNK, JUNK, '555s 147m 258m 369m 1s'],
      wall: '9m 9m 9m 2p 1p',
    });
    g = act(g, 0, { type: 'discard', tile: t1('5s') });
    g = act(g, 3, { type: 'pung' });
    expect(g.players[3].melds[0]).toMatchObject({ kind: 'pung', heldFourth: true });
    g = act(g, 3, { type: 'discard', tile: t1('7m') });
    g = act(g, 0, { type: 'discard', tile: t1('9m') }); // seat 0 drew 9m
    g = act(g, 1, { type: 'discard', tile: t1('9m') });
    g = act(g, 2, { type: 'discard', tile: t1('9m') });
    // Seat 3's turn: it drew 2p, and can kong the 5s it kept in hand.
    expect(g.step).toMatchObject({ kind: 'act', seat: 3 });
    expect(legalActions(g, 3).unpaidKongs).toEqual([t1('5s')]);
    g = act(g, 3, { type: 'kong', tile: t1('5s') });
    const kong = g.settlements.find((s) => s.kind === 'kong')!;
    expect(kong).toMatchObject({ meldKind: 'kong-added', unpaid: 'pung-then-kong', payments: [] });
    expect(g.players[3].melds[0].kind).toBe('kong-added');
    expect(g.step).toMatchObject({ kind: 'act', seat: 3, afterKong: true }); // still draws a replacement
    expect(deltasOf(g)).toEqual([0, 0, 0, 0]);
  });

  it('贴杠 not made in the turn the 4th tile was drawn → no payment', () => {
    const g = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', JUNK, JUNK, JUNK],
      wall: '7s 8s 9s 1s',
    });
    const p0 = g.players[0];
    p0.hand = T('5s 123m 456m 789m 9s'); // the 5s has been sitting in hand
    p0.melds = [{ kind: 'pung', tile: t1('5s'), from: 2 }];
    p0.turnDraws = [t1('9s')];
    const h = act(g, 0, { type: 'kong', tile: t1('5s') });
    const kong = h.settlements.find((s) => s.kind === 'kong')!;
    expect(kong).toMatchObject({ unpaid: 'late-added-kong', payments: [] });
    expect(h.players[0].melds[0].kind).toBe('kong-added');
  });

  it('an unpaid kong still counts as a root, and transfers nothing on 杠上炮', () => {
    const g = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', '123m 456m 789m 123s 9s', JUNK, JUNK],
      wall: '7s 8s 9s',
    });
    const p0 = g.players[0];
    p0.hand = T('5s 123m 456m 789m 9s');
    p0.melds = [{ kind: 'pung', tile: t1('5s'), from: 2 }];
    let h = act(g, 0, { type: 'kong', tile: t1('5s') });
    h = act(h, 0, { type: 'discard', tile: t1('9s') });
    h = act(h, 1, { type: 'hu' });
    expect(h.settlements.map((s) => s.kind)).toEqual(['kong', 'dianpao']);
    expect(h.players[1].won!.fan.items.map((i) => i.key)).toContain('gangshangpao');
  });

  it('can be switched off', () => {
    const g = setupPlay({
      hands: ['123m 456m 789m 11s 23s 9p', JUNK, JUNK, JUNK],
      wall: '7s 8s 9s 1s',
      rules: { strictAddedKongPay: false },
    });
    const p0 = g.players[0];
    p0.hand = T('5s 123m 456m 789m 9s');
    p0.melds = [{ kind: 'pung', tile: t1('5s'), from: 2, heldFourth: true }];
    const h = act(g, 0, { type: 'kong', tile: t1('5s') });
    expect(deltasOf(h)).toEqual([3, -1, -1, -1]);
  });
});
