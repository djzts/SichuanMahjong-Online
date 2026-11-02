/** Language selection. `S` is a live binding: read it at render time, never cache it. */
import { en } from './strings.en';
import { zh } from './strings.zh';

export type Lang = 'zh' | 'en';
export type Strings = typeof zh;

export let lang: Lang = 'zh';
export let S: Strings = zh;

const KEY = 'scmj.lang';

export function setLang(l: Lang): void {
  lang = l;
  S = l === 'en' ? en : zh;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    document.title = S.appTitle;
  }
}

export function initLang(): void {
  let stored: string | null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  const browser = typeof navigator !== 'undefined' ? navigator.language : 'zh';
  setLang(stored === 'en' || stored === 'zh' ? stored : browser.startsWith('zh') ? 'zh' : 'en');
}

/** Bot names are stored in Chinese by the host; show them in the reader's language. */
export function displayName(name: string): string {
  return S.aiNames[name] ?? name;
}
