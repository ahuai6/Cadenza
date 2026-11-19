import { describe, it, expect } from 'vitest';
import { splitNote } from '../../src/app/ui/kit';

describe('a label with a long note in brackets', () => {
  it('shows the label alone and keeps the note for the hover', () => {
    expect(splitNote('懸停（鏡頭停在歌詞中間，帶圓舞般的弧線移動）')).toEqual([
      '懸停',
      '鏡頭停在歌詞中間，帶圓舞般的弧線移動',
    ]);
    expect(splitNote('Dream (exposure, haze, halo)')).toEqual(['Dream', 'exposure, haze, halo']);
  });
  it('leaves a short bracket where it is', () => {
    expect(splitNote('下載（約 40 MB）')).toEqual(['下載（約 40 MB）', '']);
    expect(splitNote('速度')).toEqual(['速度', '']);
  });
});
