// The albums, standing on a line (docs/DESIGN.md, 節拍線): one row of covers with their feet on it; the chosen one in
// the middle, larger; its name over the line and its songs under it. The line is the song's own: while a song of the
// chosen album plays, it fills to where the song is, a ring spreading from that point on every beat.
import { useEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { openMenu, useStore, type useIndex } from '../state';
import { Button, Cover, Empty } from '../ui/kit';
import { engine } from '../playback/stage';
import { player } from '../playback/player';
import { menuFor, run } from '../commands';
import { TrackList } from './Library';
import s from './AlbumLine.module.css';

/** a cover's width and the room between two, px (the chosen one is drawn GROW times as large, with ROOM more each side) */
const SIZE = 150,
  GAP = 30,
  GROW = 1.5,
  ROOM = (SIZE * (GROW - 1)) / 2 + 8;
/** covers drawn each side of the chosen one (the rest are only room: a library of a thousand albums draws sixty) */
const NEAR = 30;

type Albums = ReturnType<typeof useIndex>['albums'];

export function AlbumLine({ items }: { items: Albums }) {
  const playing = useStore(player, (x) => x.id),
    isOn = useStore(player, (x) => x.playing),
    bpm = useStore(player, (x) => x.session?.map.bpm || 0);
  // the chosen album: the playing song's to begin with (else the first), then whichever is picked
  const [key, setKey] = useState<string | null>(null);
  const at = useMemo(() => {
    const byKey = key == null ? -1 : items.findIndex((a) => a.key === key);
    if (byKey >= 0) return byKey;
    const byPlay = items.findIndex((a) => a.tracks.some((t) => t.id === playing));
    return Math.max(0, byPlay);
    // (the playing song only decides before anything is picked: a new song does not move a chosen album away)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, key]);
  const album = items[at];
  const mine = !!album && album.tracks.some((t) => t.id === playing);
  const pick = (i: number) => {
    const a = items[Math.max(0, Math.min(items.length - 1, i))];
    if (a) setKey(a.key);
  };
  // the wheel walks along the line (one album a notch); left and right do, too
  const river = useRef<HTMLDivElement>(null),
    wheelAt = useRef(0);
  useEffect(() => {
    const el = river.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt.current < 90) return;
      wheelAt.current = now;
      pick(at + (d > 0 ? 1 : -1));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  // the line fills with the song (written straight to the style, on the engine's tick: no render per frame)
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = line.current;
    if (!el) return;
    if (!mine) {
      el.style.setProperty('--k', '0');
      return;
    }
    const paint = (t: number) => {
      const d = player.get().session?.musicEnd || 0.01;
      el.style.setProperty('--k', Math.min(1, Math.max(0, t / d)).toFixed(4));
    };
    paint(engine.time);
    return engine.on('tick', (p) => paint(p.t));
  }, [mine, playing]);
  if (!album) return <Empty title={tx('s.empty.results')} icon="search" />;
  const from = Math.max(0, at - NEAR),
    to = Math.min(items.length, at + NEAR + 1),
    ids = album.tracks.map((t) => t.id);
  return (
    <div className={s.wrap} data-test="album-line">
      <header className={s.head}>
        <div className={s.name} key={album.key}>
          <h2 className="display">{album.name || tx('s.unknownAlbum')}</h2>
          <p>{[album.artist, album.year, tx('s.tracks', { n: album.tracks.length })].filter(Boolean).join(' · ')}</p>
        </div>
        <Button kind="primary" icon="play" onClick={() => run('tracks.play', { kind: 'tracks', ids })}>
          {tx('s.playAll')}
        </Button>
      </header>
      <div
        className={s.river}
        ref={river}
        role="listbox"
        aria-label={tx('s.albums')}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            pick(at + (e.key === 'ArrowRight' ? 1 : -1));
          } else if (e.key === 'Enter') run('tracks.play', { kind: 'tracks', ids });
        }}
      >
        <div
          className={s.row}
          style={{
            transform: `translate3d(${-(at * (SIZE + GAP) + ROOM + SIZE / 2)}px,0,0)`,
            paddingLeft: from * (SIZE + GAP),
          }}
        >
          {items.slice(from, to).map((a, k) => {
            const i = from + k;
            return (
              <button
                key={a.key || '-'}
                type="button"
                role="option"
                aria-selected={i === at}
                aria-label={a.name || tx('s.unknownAlbum')}
                className={s.item}
                data-on={i === at}
                tabIndex={-1}
                onClick={() => (i === at ? run('tracks.play', { kind: 'tracks', ids }) : pick(i))}
                onContextMenu={(e) => openMenu(e, menuFor({ kind: 'tracks', ids: a.tracks.map((t) => t.id) }))}
              >
                <Cover k={a.cover} full={i === at} />
              </button>
            );
          })}
        </div>
        <div
          className={s.line}
          ref={line}
          data-live={mine && isOn}
          style={bpm ? ({ '--beat': `${(60 / bpm).toFixed(3)}s` } as React.CSSProperties) : undefined}
          aria-hidden="true"
        >
          <i className={s.fill} />
          <i className={s.dot} />
          <i className={s.ring} />
          <i className={s.ticks} />
        </div>
      </div>
      <div className={s.songs} key={album.key}>
        <TrackList tracks={album.tracks} numbered />
      </div>
    </div>
  );
}
