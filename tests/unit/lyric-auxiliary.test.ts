import { expect, test } from 'vitest';
import { mergeAuxiliaryLyrics } from '../../src/lyrics/document';

test('translation merges unique anchors without changing source formatting', () => {
  const old = '[ar:Fixture]\r\n[0:01.20]Old\r\n\r\n[0:02.30]\r\n';
  const extra = '[00:01.200]New\n[00:02.300]Fill\n[00:03.400]Extra';
  expect(mergeAuxiliaryLyrics(old, extra, false)).toBe(old.replace('[0:02.30]', '[0:02.30]Fill') + '[00:03.400]Extra');
  expect(mergeAuxiliaryLyrics(old, extra, true)).toContain('[0:01.20]New\r\n\r\n');
  expect(mergeAuxiliaryLyrics(old + '[0:01.20]Again', extra, true)).toBeNull();
  expect(mergeAuxiliaryLyrics('unanchored', extra, false)).toBeNull();
});
