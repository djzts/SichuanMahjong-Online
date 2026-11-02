import { describe, expect, it } from 'vitest';
import { calcFan, maxReadyFan, winAmount, type WinContext } from '../src/engine/fan';
import { makeRules } from '../src/engine/rules';
import type { Meld } from '../src/engine/types';
import { T, t1 } from './helpers';

const rules = makeRules();
const fan = (hand: string, melds: Meld[] = [], ctx: WinContext = { selfDraw: false }, r = rules) =>
  calcFan(T(hand), melds, ctx, r)!;
const pung = (s: string): Meld => ({ kind: 'pung', tile: t1(s) });
const kong = (s: string): Meld => ({ kind: 'kong-exposed', tile: t1(s) });

describe('hand patterns', () => {
  it.each([
    ['123m 456m 789m 234s 55s', 'pinghu', 0],
    ['111m 333m 555s 777s 99s', 'duiduihu', 1],
    ['123m 456m 789m 234m 55m', 'qingyise', 2],
    ['11m 22m 33m 44s 55s 66s 77s', 'qidui', 2],
    ['1111m 22m 33m 44s 55s 66s', 'longqidui', 3],
    ['111m 333m 555m 777m 99m', 'qingdui', 3],
    ['123m 789m 123s 789s 99p', 'daiyaojiu', 2],
    ['222m 555m 888s 222s 55p', 'jiangdui', 3],
  ])('%s → %s', (hand, pattern, n) => {
    const r = fan(hand);
    expect(r.pattern).toBe(pattern);
    expect(r.fan).toBe(n);
  });

  it('pure seven pairs and pure dragon seven pairs are capped', () => {
    const a = fan('11m 22m 33m 44m 55m 66m 77m');
    expect(a.pattern).toBe('qingqidui');
    expect(a.rawFan).toBe(4);
    expect(a.fan).toBe(3);
    expect(a.capped).toBe(true);
    const b = fan('1111m 22m 33m 44m 55m 66m');
    expect(b.pattern).toBe('qinglongqidui');
    expect(b.rawFan).toBe(5);
  });

  it('composite patterns do not stack their components', () => {
    const r = fan('111m 333m 555m 777m 99m', [], { selfDraw: false }, makeRules({ capFan: 10 }));
    expect(r.rawFan).toBe(3); // 清对 = 3, not 清一色 2 + 对对胡 1
  });

  it('金钩钓 adds one fan on top of 对对胡', () => {
    const r = fan('99s', [pung('1m'), pung('3m'), pung('5s'), pung('7s')]);
    expect(r.pattern).toBe('duiduihu');
    expect(r.items.map((i) => i.key)).toContain('jingoudiao');
    expect(r.fan).toBe(2);
  });
});

describe('roots (根)', () => {
  it('four concealed copies count as a root', () => {
    const r = fan('111m 123m 456m 789s 55s');
    expect(r.roots).toBe(1);
    expect(r.fan).toBe(1);
  });

  it('a kong counts as a root', () => {
    const r = fan('123m 456m 789m 99p', [kong('5s')]);
    expect(r.roots).toBe(1);
    expect(r.fan).toBe(1);
  });

  it('a pung plus the fourth copy in hand counts as a root', () => {
    const r = fan('345s 123m 456m 99p', [pung('5s')]);
    expect(r.roots).toBe(1);
  });

  it('the dragon in 龙七对 is not counted again as a root', () => {
    const r = fan('1111m 2222m 33m 44s 55s', [], { selfDraw: false }, makeRules({ capFan: 10 }));
    expect(r.pattern).toBe('longqidui');
    expect(r.roots).toBe(1);
    expect(r.rawFan).toBe(4);
  });
});

describe('bonuses and cap', () => {
  it('situational bonuses add one fan each', () => {
    const base = '123m 456m 789m 234s 55s';
    expect(fan(base, [], { selfDraw: true, kongFlower: true }).fan).toBe(1);
    expect(fan(base, [], { selfDraw: false, kongDiscard: true }).fan).toBe(1);
    expect(fan(base, [], { selfDraw: false, robKong: true }).fan).toBe(1);
    expect(fan(base, [], { selfDraw: true, lastTile: true }).items[1].key).toBe('haidilaoyue');
    expect(fan(base, [], { selfDraw: false, lastTile: true }).items[1].key).toBe('haidipao');
  });

  it('天胡 / 地胡 go straight to the cap', () => {
    expect(fan('123m 456m 789m 234s 55s', [], { selfDraw: true, heavenly: true }).fan).toBe(3);
    expect(fan('123m 456m 789m 234s 55s', [], { selfDraw: true, earthly: true }).fan).toBe(3);
  });

  it('payment = base × 2^fan, self-draw adds one base after the cap', () => {
    const qing = fan('123m 456m 789m 234m 55m');
    expect(winAmount(qing, false, rules)).toBe(4);
    expect(winAmount(qing, true, rules)).toBe(5);
    const big = fan('11m 22m 33m 44m 55m 66m 77m');
    expect(winAmount(big, true, rules)).toBe(9);
  });

  it('self-draw "add fan" mode adds a fan before the cap', () => {
    const r = makeRules({ selfDrawBonus: 'fan' });
    const f = fan('123m 456m 789m 234m 55m', [], { selfDraw: true }, r);
    expect(f.fan).toBe(3);
    expect(winAmount(f, true, r)).toBe(8);
    const capped = fan('111m 333m 555m 777m 99m', [], { selfDraw: true }, r);
    expect(capped.fan).toBe(3);
  });
});

describe('maxReadyFan (查大叫)', () => {
  it('takes the best possible win, capped', () => {
    expect(maxReadyFan(T('11m 22m 33m 44m 55m 66m 7m'), [], rules)).toBe(3);
    expect(maxReadyFan(T('11m 22m 33m 44m 55s 66s 7s'), [], rules)).toBe(2);
    expect(maxReadyFan(T('111m 333m 555s 77s 99s'), [], rules)).toBe(1);
  });

  it('returns null for a hand that is not ready', () => {
    expect(maxReadyFan(T('139m 456m 789m 13s 5s'), [], rules)).toBeNull();
  });
});
