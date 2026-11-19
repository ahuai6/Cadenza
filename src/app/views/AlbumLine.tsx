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
import { indexLetter, LETTERS } from '../letters';
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

/** albums at least this many: an index of their letters over the line */
const INDEX_FROM = 12;

export function AlbumLine({ items: given }: { items: Albums }) {
  // (along the line in the order of their index letters — A to Z, then the rest — and by name within one: a jump to a
  // letter lands on the first of a run)
  const items = useMemo(
    () =>
      given
        .map((a) => ({ a, l: indexLetter(a.name || '') }))
        .sort(
          (x, y) =>
            LETTERS.indexOf(x.l) - LETTERS.indexOf(y.l) ||
            x.a.name.localeCompare(y.a.name, undefined, { numeric: true, sensitivity: 'base' }),
        )
        .map((x) => x.a),
    [given],
  );
  const firsts = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((a, i) => {
      const l = indexLetter(a.name || '');
      if (!m.has(l)) m.set(l, i);
    });
    return m;
  }, [items]);
  const playing = useStore(player, (x) => x.id),
    isOn = useStore(player, (x) => x.playing);
  // (the first time the line is drawn it comes in with its shelf, all of it together: the name and the songs rise in
  // on their own only when another album is chosen)
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
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
  // held and dragged, the line goes with the pointer; let go, it carries on and slows to a stop (its speed as it was
  // let go), then settles on the album nearest the middle. Where it is meanwhile: `pos`, in albums along the line.
  const [pos, setPos] = useState<number | null>(null);
  const drag = useRef<{
    x0: number;
    p0: number;
    moved: boolean;
    v: number;
    lx: number;
    lt: number;
    raf: number;
  } | null>(null);
  const STEP = SIZE + GAP;
  const clampPos = (p: number) => Math.max(-0.45, Math.min(items.length - 0.55, p));
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || items.length < 2) return;
    const d = drag.current;
    if (d) cancelAnimationFrame(d.raf);
    const p0 = pos ?? at;
    drag.current = { x0: e.clientX, p0, moved: false, v: 0, lx: e.clientX, lt: performance.now(), raf: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.raf) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 6) return;
    if (!d.moved) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const now = performance.now(),
      dt = Math.max(1, now - d.lt);
    // (its speed, albums a millisecond, eased over the last moves)
    d.v = d.v * 0.6 + (-(e.clientX - d.lx) / STEP / dt) * 0.4;
    d.lx = e.clientX;
    d.lt = now;
    setPos(clampPos(d.p0 - (e.clientX - d.x0) / STEP));
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      drag.current = null;
      return;
    }
    let p = pos ?? at,
      v = performance.now() - d.lt > 80 ? 0 : d.v,
      last = performance.now();
    const coast = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      p = clampPos(p + v * dt);
      v *= Math.pow(0.994, dt); // (slows by about a tenth every 16 ms)
      if (Math.abs(v) > 0.0004 && p > -0.45 && p < items.length - 0.55) {
        setPos(p);
        d.raf = requestAnimationFrame(coast);
        return;
      }
      drag.current = null;
      setPos(null);
      pick(Math.round(p));
    };
    d.raf = requestAnimationFrame(coast);
  };
  useEffect(() => () => cancelAnimationFrame(drag.current?.raf ?? 0), []);
  const shown = pos ?? at;
  // the line fills with the song, and the ring spreads from where it is on every beat — the beat the rhythm engine
  // found, read off the same tick as everything else that keeps time (never a clock of its own at the song's average
  // tempo, drifting off the music; a paused song holds it still). Written straight to the style: no render per frame.
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = line.current;
    if (!el) return;
    if (!mine) {
      el.style.setProperty('--k', '0');
      return;
    }
    const paint = (t: number, ph: number) => {
      const d = player.get().session?.musicEnd || 0.01;
      el.style.setProperty('--k', Math.min(1, Math.max(0, t / d)).toFixed(4));
      el.style.setProperty('--ph', ph.toFixed(3));
    };
    paint(engine.time, 1);
    return engine.on('tick', (p) => paint(p.t, p.rs ? p.rs.phase : 1));
  }, [mine, playing]);
  if (!album) return <Empty title={tx('s.empty.results')} icon="search" />;
  const from = Math.max(0, Math.round(shown) - NEAR),
    to = Math.min(items.length, Math.round(shown) + NEAR + 1),
    ids = album.tracks.map((t) => t.id);
  return (
    <div className={s.wrap} data-test="album-line">
      <header className={s.head}>
        <div className={s.name} key={album.key} data-still={first.current || undefined}>
          <h2 className="display">{album.name || tx('s.unknownAlbum')}</h2>
          <p>{[album.artist, album.year, tx('s.tracks', { n: album.tracks.length })].filter(Boolean).join(' · ')}</p>
        </div>
        <Button kind="primary" icon="play" onClick={() => run('tracks.play', { kind: 'tracks', ids })}>
          {tx('s.playAll')}
        </Button>
      </header>
      {items.length >= INDEX_FROM && firsts.size > 1 && (
        <nav className={s.letters} aria-label={tx('s.albums')} data-test="album-letters">
          {[...firsts].map(([l, i]) => (
            <button
              key={l}
              type="button"
              aria-current={indexLetter(album.name || '') === l || undefined}
              onClick={() => pick(i)}
            >
              {l}
            </button>
          ))}
        </nav>
      )}
      <div
        className={s.river}
        ref={river}
        role="listbox"
        aria-label={tx('s.albums')}
        tabIndex={0}
        data-drag={pos != null || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // (a drag is not a click on the cover it ended over)
        onClickCapture={(e) => {
          if (drag.current?.moved || pos != null) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
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
            transform: `translate3d(${-(shown * (SIZE + GAP) + ROOM + SIZE / 2)}px,0,0)`,
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
        <div className={s.line} ref={line} data-live={mine && isOn} aria-hidden="true">
          <i className={s.fill} />
          <i className={s.dot} />
          <i className={s.ring} />
          <i className={s.ticks} />
        </div>
      </div>
      <div className={s.songs} key={album.key} data-still={first.current || undefined}>
        <TrackList tracks={album.tracks} numbered />
      </div>
    </div>
  );
}
