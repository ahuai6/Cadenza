// A title's index letter (both interfaces' A–Z indexes): a Latin letter as itself (accents dropped), a Chinese character
// by its pinyin initial, kana by its Hepburn initial, anything else '#'.
// the index letter of a title, as a phone's contacts do it: a Latin letter is itself (accents dropped), a Chinese character
// takes its pinyin's initial (found against the first character of each initial in pinyin order), kana their row's
// romanisation; digits, symbols and other scripts go under #
const PINYIN = new Intl.Collator('zh-u-co-pinyin', { sensitivity: 'base' });
const PY_FIRST: [string, string][] = [
  ['A', '阿'],
  ['B', '八'],
  ['C', '嚓'],
  ['D', '搭'],
  ['E', '鵝'],
  ['F', '发'],
  ['G', '旮'],
  ['H', '哈'],
  ['J', '丌'],
  ['K', '咔'],
  ['L', '垃'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '噢'],
  ['P', '啪'],
  ['Q', '七'],
  ['R', '蚺'],
  ['S', '仨'],
  ['T', '他'],
  ['W', '屲'],
  ['X', '夕'],
  ['Y', '丫'],
  ['Z', '帀'],
];
// each kana's Hepburn initial, in the order of あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん, then the voiced ones
const KANA =
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ';
const KANA_L = 'AIUEOKKKKKSSSSSTCTTTNNNNNHHFHHMMMMMYYYRRRRRWONGGGGGZJZZZDJZDDBBBBBPPPPP';
export function indexLetter(title: string): string {
  const ch = [...title.trim().normalize('NFKC')].find((c) => /[\p{L}\p{N}]/u.test(c));
  if (!ch) return '#';
  const lat = ch.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  if (/^[A-Z]$/.test(lat)) return lat;
  if (/\p{Script=Han}/u.test(ch)) {
    let k = '#';
    for (const [L, first] of PY_FIRST) {
      if (PINYIN.compare(ch, first) >= 0) k = L;
      else break;
    }
    return k;
  }
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) {
    const h = String.fromCharCode(
        /\p{Script=Katakana}/u.test(ch) && ch >= 'ァ' && ch <= 'ヶ' ? ch.charCodeAt(0) - 0x60 : ch.charCodeAt(0),
      ),
      small = 'ぁぃぅぇぉっゃゅょゎ',
      big = 'あいうえおつやゆよわ',
      q = small.includes(h) ? big[small.indexOf(h)] : h,
      i = KANA.indexOf(q);
    if (i >= 0) return KANA_L[i];
  }
  return '#';
}
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#';
