import { describe, expect, it } from 'vitest';
import { DEFAULT_FAN_TABLE } from '../src/engine/rules';
import { en } from '../src/ui/strings.en';
import { zh } from '../src/ui/strings.zh';

describe('UI strings', () => {
  it('both languages name every fan item the engine can produce', () => {
    const keys = [...Object.keys(DEFAULT_FAN_TABLE), 'tianhu', 'dihu', 'zimo'];
    for (const k of keys) {
      expect(zh.fanNames[k], `zh ${k}`).toBeTruthy();
      expect(en.fanNames[k], `en ${k}`).toBeTruthy();
    }
  });

  it('English has the same keys as Chinese', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
