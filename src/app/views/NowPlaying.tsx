// The stage (the engine's picture) and the now-playing page over it: the cover on the left with the song's controls,
// the lyrics on the right. The picture behind is the engine's ambient view — the same backdrop, palette and rhythm the
// effect lyrics use — so it is always the shown song's, and the effect view grows out of it.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { tx } from '../../i18n';
import { ui, useStore, trackOf, openMenu, lib } from '../state';
import { Icon } from '../ui/icons';
import { IconButton, Cover, Swap, Badge } from '../ui/kit';
import { Drive } from '../motion';
import { engine } from '../playback/stage';
import { player } from '../playback/player';
import { refs, openFx } from '../layers';
import { NpLyrics } from '../ui/NpLyrics';
import { QualityTag } from '../ui/quality';
import { Marquee } from '../ui/Marquee';
import { HifiBadge, Heart } from './Player';
import { pickPlaylist, editMeta, npSettings } from './Modals';
import s from './NowPlaying.module.css';

export function Stage() {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    refs.stage = el.current;
    engine.mount(el.current!);
    return () => {
      refs.stage = null;
    };
  }, []);
  return <div data-test="stage" className={s.stage} ref={el} data-vis="false" aria-hidden="true" />;
}

export function NowPlaying() {
  const album = useStore(player, (x) => !!x.album),
    dir = useStore(player, (x) => x.dir),
    shownId = useStore(player, (x) => x.shownId),
    hasLyrics = useStore(player, (x) => x.hasLyrics),
    session = useStore(player, (x) => x.session),
    instr = useStore(lib, () => !!trackOf(shownId)?.instrumental);
  useStore(lib, (x) => x.tracks);
  const t = trackOf(shownId);
  const amb = useRef<HTMLDivElement>(null),
    root = useRef<HTMLElement>(null),
    cover = useRef<HTMLDivElement>(null),
    info = useRef<HTMLDivElement>(null),
    right = useRef<HTMLDivElement>(null),
    halo = useRef<HTMLDivElement>(null);
  const layer = useStore(ui, (x) => x.layer);
  useLayoutEffect(() => {
    refs.np = root.current;
    refs.npAmb = amb.current;
    refs.npCover = cover.current;
    refs.npParts = [info.current, right.current];
  });
  useEffect(
    () => () => {
      refs.np = null;
      refs.npAmb = null;
      refs.npCover = null;
      refs.npParts = [];
    },
    [],
  );
  // the song's own light, for the glow under the cover and the tint of the shade at the edges (the engine's palette)
  const tone = useMemo(() => {
    const A = session?.ambient;
    if (!A) return {};
    const c = A.cols[0] || A.base,
      rgb = (v: number[]) => v.map((x) => Math.round(x)).join(',');
    return { '--amb': rgb(c), '--amb-base': rgb(A.base) } as React.CSSProperties;
  }, [session]);
  // full screen: the controls rest out of sight while the pointer does (any move, key or wheel brings them back)
  const full = useStore(ui, (x) => x.win.full);
  useEffect(() => {
    const el = root.current;
    if (!el || !full || layer !== 'np') {
      if (el) el.dataset.idle = 'false';
      return;
    }
    let tm = 0;
    const wake = () => {
      el.dataset.idle = 'false';
      clearTimeout(tm);
      tm = window.setTimeout(() => {
        if (!el.querySelector(':focus-visible, [aria-expanded="true"]')) el.dataset.idle = 'true';
      }, 2600);
    };
    wake();
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
    evs.forEach((e) => addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(tm);
      evs.forEach((e) => removeEventListener(e, wake));
      el.dataset.idle = 'false';
    };
  }, [full, layer]);
  if (!t) return null;
  const more = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: tx('np.findLyr'), icon: 'search', run: () => npSettings('lyrics') },
      { label: tx('np.set') + '…', icon: 'lyrics', run: () => npSettings('view') },
      '-',
      { label: tx('s.addToPl'), icon: 'plus', run: () => pickPlaylist([t.id]) },
      { label: tx('s.meta.menu'), icon: 'tag', run: () => editMeta(t) },
    ]);
  const live = layer === 'np';
  // above the title: the album, its year and the track's place on it
  const kicker = [t.album, t.year, t.track ? tx('np.trackNo', { n: t.track }) : ''].filter(Boolean).join(' · ');
  return (
    <>
      {/* the cinema around the picture: a shade at the edges in the song's own dark, and a fine grain over the colour */}
      {/* (each as a box that cuts and a layer inside it moving the other way — layers.ts: the opening moves them, it never
        repaints them) */}
      <div className={s.amb} ref={amb} style={tone} data-vis="false" aria-hidden="true">
        <div className={s.ambIn} data-in />
      </div>
      <section
        data-test="np"
        className={s.np + ' on-picture'}
        ref={root}
        style={tone}
        data-vis="false"
        aria-hidden={layer === 'none'}
        inert={layer !== 'np'}
      >
        <div className={s.sheet} data-in>
          <div className={s.main}>
            <div className={s.left}>
              {/* (the cover's own light spilling behind it: the left column's weight against the lyrics) */}
              <div className={s.coverBox}>
                <div className={s.halo + ' ' + s.fade} ref={halo} data-q aria-hidden="true">
                  <Swap k={t.cover || ''} dir={dir} fill>
                    <Cover k={t.cover} full />
                  </Swap>
                </div>
                <div className={s.cover} ref={cover} data-test="np-cover">
                  {/* (its shadows — the mini cover's and its own — and its picture each on a layer of their own, in its
                  transform: the opening crosses the shadows and rounds the clip, it never repaints the picture) */}
                  <i className={s.shM} data-sh="mini" aria-hidden="true" />
                  <i className={s.shP} data-sh="page" aria-hidden="true" />
                  <div className={s.coverClip} data-clip>
                    <Swap k={t.cover || ''} dir={dir} fill>
                      <Cover k={t.cover} full eager />
                    </Swap>
                  </div>
                </div>
              </div>
              <div className={s.info} ref={info}>
                <div className={s.fade + ' ' + s.infoIn}>
                  <div className={s.meta}>
                    <Swap k={t.id} dir={dir}>
                      <div>
                        {/* (nothing ends in an ellipsis here: a long one scrolls) */}
                        {kicker && <Marquee className={s.kicker}>{kicker}</Marquee>}
                        <Marquee className={s.title}>{t.title}</Marquee>
                        <Marquee className={s.artist}>{t.artist || tx('s.unknownArtist')}</Marquee>
                        <HifiBadge />
                      </div>
                    </Swap>
                    <span className={s.heart}>
                      <Heart id={t.id} />
                    </span>
                  </div>
                  <div className={s.qrow}>
                    <QualityTag t={t} look="glass" />
                    {album && <Badge>{tx('s.albumOn')}</Badge>}
                  </div>
                  {/* what else this song can be: its effect lyrics; and the rest of what can be done with it */}
                  <div className={s.acts}>
                    <button type="button" className={s.fx} data-test="open-fx" onClick={openFx}>
                      <Icon n="sparkles" size={16} />
                      {tx('s.fxLyrics')}
                    </button>
                    <IconButton n="more" label={tx('s.more')} onClick={more} />
                  </div>
                </div>
              </div>
            </div>
            <div className={s.right} ref={right}>
              {/* a new song's lyrics come in from the side the queue went (a replan of the same song: in place, at once) */}
              <div key={shownId || ''} className={s.swapIn} style={{ ['--sd' as string]: dir }}>
                {instr ? (
                  <div className={s.fade}>
                    <Instrumental />
                  </div>
                ) : hasLyrics && session ? (
                  <NpLyrics key={session.version + ':' + shownId} lines={session.doc.lines} live={live} />
                ) : (
                  <div className={s.fade}>
                    <NoLyrics />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
/** A song marked as an instrumental: this, in place of lyrics. */
function Instrumental() {
  return (
    <div className={s.none}>
      <Icon n="note" size={30} />
      <b>{tx('s.instr.text')}</b>
    </div>
  );
}
function NoLyrics() {
  return (
    <div className={s.none}>
      <Icon n="lyrics" size={30} />
      <b>{tx('s.noLyrics')}</b>
      <p>{tx('s.noLyricsHelp')}</p>
    </div>
  );
}

export { Drive };
