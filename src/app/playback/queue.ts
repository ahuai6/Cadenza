// The queue's own rules, kept apart from the player so they can be tried on their own: where "play next" puts songs, and
// how a queue taken from a list keeps up with that list.

/** Songs put right after the one playing (each only once: taken from wherever else they were waiting further on). */
export function insertNext(queue: string[], index: number, ids: string[]): string[] {
  const add = ids.filter((id, k) => ids.indexOf(id) === k && id !== queue[index]),
    head = queue.slice(0, index + 1),
    tail = queue.slice(index + 1).filter((id) => !add.includes(id));
  return [...head, ...add, ...tail];
}

/**
 * A list the queue was taken from has gained songs: the queue gains them too, each after the song it follows in the
 * list (at the end when none before it is in the queue). The queue counts as taken from the list when it holds exactly
 * the list's songs as they were — the songs played from a playlist, the favourites, the whole library. Null: nothing to
 * do (the queue is not that list's, or nothing was added).
 */
export function followList(queue: string[], before: string[], now: string[]): string[] | null {
  if (!before.length || now.length <= before.length || queue.length !== before.length) return null;
  const had = new Set(before);
  if (!queue.every((id) => had.has(id))) return null;
  const added = now.filter((id) => !had.has(id));
  if (!added.length) return null;
  const q = queue.slice();
  for (const id of added) {
    if (q.includes(id)) continue;
    const at = now.indexOf(id);
    let after = -1;
    for (let k = at - 1; k >= 0 && after < 0; k--) after = q.indexOf(now[k]);
    q.splice(after < 0 ? q.length : after + 1, 0, id);
  }
  return q;
}
