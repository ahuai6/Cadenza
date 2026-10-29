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
}
export const LYRIC_TYPES: Record<string, LyricType> = {
  /** 流動: the words follow a path through space one by one as they are sung, each its own size */
  flow: { id: 'flow', together: false, sizes: true },
  /** 整句: the whole line is there from its first word, one size, lighting up word by word as it is sung */
  line: { id: 'line', together: true, sizes: false },
};
export const lyricType = (id: string | undefined): LyricType => LYRIC_TYPES[id || 'flow'] || LYRIC_TYPES.flow;
