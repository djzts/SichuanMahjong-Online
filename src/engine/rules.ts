/** All rule options in one place. Values in comments are the defaults. */
export interface FanTable {
  pinghu: number; // 平胡
  duiduihu: number; // 对对胡
  qingyise: number; // 清一色
  qidui: number; // 七对
  longqidui: number; // 龙七对
  qingdui: number; // 清对
  qingqidui: number; // 清七对
  qinglongqidui: number; // 清龙七对
  jingoudiao: number; // 金钩钓 (bonus on top of the hand pattern)
  daiyaojiu: number; // 带幺九
  jiangdui: number; // 将对
  gen: number; // 根 (per root)
  gangshanghua: number; // 杠上花
  gangshangpao: number; // 杠上炮
  qiangganghu: number; // 抢杠胡
  haidilaoyue: number; // 海底捞月
  haidipao: number; // 海底炮
}

export interface SpectatorVisibility {
  melds: boolean; // 副露
  voidSuit: boolean; // 定缺
  handCount: boolean; // 手牌张数
  fanDetail: boolean; // 结算牌型和番型明细
}

export interface Rules {
  baseScore: number;
  capFan: number;
  selfDrawBonus: 'base' | 'fan';
  exchangeThree: boolean;
  windRain: boolean; // 刮风下雨
  callTransfer: boolean; // 呼叫转移
  multipleWinners: boolean; // 一炮多响
  passHuLock: boolean; // 过水不胡
  refundOnDraw: boolean; // 退税
  heavenEarthCap: boolean; // 天胡/地胡 直接封顶
  /**
   * 补杠只在两种情况下不收钱（仍然算杠）：先碰后杠（碰的时候手里已有暗刻），
   * 或者摸到第 4 张后没有当轮贴杠。
   */
  strictAddedKongPay: boolean;
  fan: FanTable;
  timers: {
    enabled: boolean;
    exchangeSec: number;
    voidSec: number;
    turnSec: number;
    claimSec: number;
  };
  spectator: {
    slots: number;
    visible: SpectatorVisibility;
  };
}

export const DEFAULT_FAN_TABLE: FanTable = {
  pinghu: 0,
  duiduihu: 1,
  qingyise: 2,
  qidui: 2,
  longqidui: 3,
  qingdui: 3,
  qingqidui: 4,
  qinglongqidui: 5,
  jingoudiao: 1,
  daiyaojiu: 2,
  jiangdui: 3,
  gen: 1,
  gangshanghua: 1,
  gangshangpao: 1,
  qiangganghu: 1,
  haidilaoyue: 1,
  haidipao: 1,
};

export const DEFAULT_RULES: Rules = {
  baseScore: 1,
  capFan: 4, // 4 番封顶 = 16 倍底分
  selfDrawBonus: 'base',
  exchangeThree: true,
  windRain: true,
  callTransfer: true,
  multipleWinners: true,
  passHuLock: true,
  refundOnDraw: true,
  heavenEarthCap: true,
  strictAddedKongPay: true,
  fan: DEFAULT_FAN_TABLE,
  timers: {
    enabled: true,
    exchangeSec: 20,
    voidSec: 20,
    turnSec: 20,
    claimSec: 10,
  },
  spectator: {
    slots: 2,
    visible: { melds: false, voidSuit: false, handCount: false, fanDetail: false },
  },
};

export function makeRules(overrides: Partial<Rules> = {}): Rules {
  return {
    ...DEFAULT_RULES,
    ...overrides,
    fan: { ...DEFAULT_FAN_TABLE, ...(overrides.fan ?? {}) },
    timers: { ...DEFAULT_RULES.timers, ...(overrides.timers ?? {}) },
    spectator: {
      ...DEFAULT_RULES.spectator,
      ...(overrides.spectator ?? {}),
      visible: { ...DEFAULT_RULES.spectator.visible, ...(overrides.spectator?.visible ?? {}) },
    },
  };
}

export const FAN_NAMES: Record<keyof FanTable, string> = {
  pinghu: '平胡',
  duiduihu: '对对胡',
  qingyise: '清一色',
  qidui: '七对',
  longqidui: '龙七对',
  qingdui: '清对',
  qingqidui: '清七对',
  qinglongqidui: '清龙七对',
  jingoudiao: '金钩钓',
  daiyaojiu: '带幺九',
  jiangdui: '将对',
  gen: '根',
  gangshanghua: '杠上花',
  gangshangpao: '杠上炮',
  qiangganghu: '抢杠胡',
  haidilaoyue: '海底捞月',
  haidipao: '海底炮',
};
