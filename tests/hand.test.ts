import { describe, expect, it } from 'vitest';
import {
  isSevenPairs,
  isStandardWin,
  isWinningCounts,
  shanten,
  waitingTiles,
} from '../src/engine/hand';
import { countsOf, tileCode } from '../src/engine/tiles';
import { T } from './helpers';

const c = (s: string) => countsOf(T(s));

describe('win detection', () => {
  it('standard 4 sets + pair', () => {
    expect(isStandardWin(c('123m 456m 789m 123s 55s'), 0)).toBe(true);
    expect(isStandardWin(c('111m 222m 333m 444s 55s'), 0)).toBe(true);
    expect(isStandardWin(c('123m 456m 789m 124s 55s'), 0)).toBe(false);
  });

  it('counts exposed melds', () => {
    expect(isStandardWin(c('123m 55s'), 3)).toBe(true);
    expect(isStandardWin(c('55s'), 4)).toBe(true);
    expect(isStandardWin(c('123m 55s'), 2)).toBe(false);
  });

  it('seven pairs, a quad counts as two pairs', () => {
    expect(isSevenPairs(c('11m 22m 33m 44m 55s 66s 77s'), 0)).toBe(true);
    expect(isSevenPairs(c('1111m 22m 33m 44m 55s 66s'), 0)).toBe(true);
    expect(isSevenPairs(c('11m 22m 33m 44m 55s 66s 78s'), 0)).toBe(false);
  });

  it('seven pairs needs a fully concealed hand', () => {
    expect(isWinningCounts(c('11m 22m 33m 44m 55s'), 1)).toBe(false);
  });
});

describe('waits', () => {
  it('nine gates waits on all nine tiles', () => {
    const w = waitingTiles(c('1112345678999m'), 0);
    expect(w.map(tileCode)).toEqual(['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m']);
  });

  it('cannot wait on a tile the player holds all four of', () => {
    const hand = c('123m 456m 789s 123s 7p');
    expect(waitingTiles(hand, 0).map(tileCode)).toEqual(['7p']);
    const owned = [...hand];
    owned[T('7p')[0]] = 4;
    expect(waitingTiles(hand, 0, owned)).toEqual([]);
  });

  it('seven pairs wait', () => {
    expect(waitingTiles(c('11m 22m 33m 44m 55s 66s 7s'), 0).map(tileCode)).toContain('7s');
  });
});

describe('shanten', () => {
  it('complete hand is -1, ready hand is 0', () => {
    expect(shanten(c('123m 456m 789m 123s 55s'), 0)).toBe(-1);
    expect(shanten(c('123m 456m 789m 123s 5s'), 0)).toBe(0);
  });

  it('one away', () => {
    expect(shanten(c('123m 456m 789m 13s 5s 9p'), 0)).toBe(1);
  });

  it('seven pairs shanten', () => {
    expect(shanten(c('11m 22m 33m 44m 55s 66s 79s'), 0)).toBe(0);
  });

  it('works with melds', () => {
    expect(shanten(c('12m 55s'), 3)).toBe(0);
    expect(shanten(c('12m 58s'), 3)).toBe(1);
    expect(shanten(c('5s'), 4)).toBe(0);
  });
});
