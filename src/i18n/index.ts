// Interface words in six languages. One lookup serves every module; new words are added with add() as
// key → [zh-Hant, zh-Hans, en, ja, ko, es].
import data from './dict.json';
import { createStore } from '../core/emitter';

export type Lang = 'zh-Hant' | 'zh-Hans' | 'en' | 'ja' | 'ko' | 'es';
export const LANGS = data.langs as [Lang, string][];
const ORDER: Lang[] = ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'es'];
const DICT = data.dict as Record<Lang, Record<string, string>>;

export const lang = createStore({ lang: 'zh-Hant' as Lang });
export const currentLang = () => lang.get().lang;
export function setLang(l: Lang) { if (DICT[l]) lang.set({ lang: l }); }

export function tx(key: string, vars?: Record<string, string | number>): string {
  const l = lang.get().lang;
  let s = DICT[l]?.[key] ?? DICT.en[key] ?? DICT['zh-Hant'][key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m));
  return s;
}
export const has = (key: string) => key in DICT.en || key in DICT['zh-Hant'];
export function add(words: Record<string, string[]>) {
  for (const [k, arr] of Object.entries(words)) ORDER.forEach((l, i) => { if (arr[i] != null) DICT[l][k] = arr[i]; });
}
export function allKeys(l: Lang) { return Object.keys(DICT[l]); }

/** The interface language from the system's preference, falling back to Traditional Chinese. */
export function detectLang(pref: readonly string[] = (typeof navigator !== 'undefined' ? navigator.languages : []) as string[]): Lang {
  for (const p of pref) {
    const s = p.toLowerCase();
    if (s.startsWith('zh')) return /hans|cn|sg/.test(s) ? 'zh-Hans' : 'zh-Hant';
    for (const l of ORDER) if (s.startsWith(l)) return l;
  }
  return 'zh-Hant';
}
