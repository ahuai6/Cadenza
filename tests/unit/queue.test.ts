import { describe, it, expect } from 'vitest';
import { insertNext, followList } from '../../src/app/playback/queue';

describe('play next', () => {
  it('puts the songs right after the one playing, each once', () => {
    expect(insertNext(['a', 'b', 'c', 'd'], 1, ['d', 'x'])).toEqual(['a', 'b', 'd', 'x', 'c']);
    // (the song playing is never put after itself; songs already played stay where they were)
    expect(insertNext(['a', 'b', 'c'], 1, ['b', 'a', 'a'])).toEqual(['a', 'b', 'a', 'c']);
  });
});

describe('a queue taken from a list', () => {
  it('gains the songs the list gains, each after the one it follows there', () => {
    expect(followList(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'x', 'b', 'c', 'y'])).toEqual(['a', 'x', 'b', 'c', 'y']);
    // (reordered in the queue: still that list's songs)
    expect(followList(['c', 'a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'n'])).toEqual(['c', 'n', 'a', 'b']);
  });
  it('leaves a queue that is not that list alone', () => {
    expect(followList(['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'n'])).toBeNull();
    expect(followList(['a', 'b', 'z'], ['a', 'b', 'c'], ['a', 'b', 'c', 'n'])).toBeNull();
    expect(followList(['a', 'b'], ['a', 'b'], ['a'])).toBeNull();
  });
});
