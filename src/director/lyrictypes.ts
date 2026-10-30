/* Lyric types: how the lyrics are presented and how they come in — the counterpart of the camera styles (which only
   frame them). A type is a few plain switches the layout and the word timing read; add one here (and its name,
   'lt.<id>', in the dictionary) and it appears in the motion pane. The entrance, the exit and how unsung words show
   are each type's own settings, below it in the pane. */
export interface LyricType {
  id: string;
  /** the words of a line come in all together with its first word (faint until sung), instead of each just before it is sung */
  together: boolean;
  /** each word its own size (a large word, a small one, …) as the line goes; otherwise one size for the whole line */
  sizes: boolean;
  /** how much more often a line goes on above or below the one before rather than onward (1: the camera style's own odds) */
  stack?: number;
  /** each line placed round the line before as round a centre (the first near the middle of the scene), now and then
   *  turned — only ever so its characters' tops face away from that centre */
  orbit?: boolean;
  /** how far apart in depth the lines and their words sit (1: as usual) */
  depth?: number;
}
export const LYRIC_TYPES: Record<string, LyricType> = {
  /** 流動: the words follow a path through space one by one as they are sung, each its own size — going on above or
   *  below the line before more often than onward */
  flow: { id: 'flow', together: false, sizes: true, stack: 1.45 },
  /** 整句: the whole line is there from its first word, one size, lighting up word by word as it is sung */
  line: { id: 'line', together: true, sizes: false },
  /** 圓心: the first line near the middle of the scene, each next one round the line before as its centre, sometimes
   *  turned with its tops outward; set deeper in space */
  orbit: { id: 'orbit', together: false, sizes: true, orbit: true, depth: 2.4 },
};
export const lyricType = (id: string | undefined): LyricType => LYRIC_TYPES[id || 'flow'] || LYRIC_TYPES.flow;
