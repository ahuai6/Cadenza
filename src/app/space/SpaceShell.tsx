// The space interface: the music library as a cathedral to walk through (docs/SPACE.md). It is the second appearance
// half of the interface: it keeps the logic half (state, actions, playback, the bridge) exactly as the classic pages do.
// The scene reads the library and the song playing through bind.ts, and plays through it; the settings page is React,
// opened by the scene (the gear, the , key, the south chapel's sculptures).
import { useEffect, useRef, useState } from 'react';
import { boot } from '../actions/boot';
import { ensureFont } from '../../engine';
import { createWorld } from './world';
import { createBind } from './bind';
import { hudHtml } from './hud';
import { SpaceSettings } from './SpaceSettings';
import { lang as langStore } from '../../i18n';
import { useStore, settings } from '../state';
import './space.css';
import s from './SpaceShell.module.css';

// every face the scene's textures and the HUD draw with, loaded before the first texture is drawn
const FACES: [string, string][] = [['serif', '聖堂中殿全部歌曲歌單設定播放中清晨的光'], ['notosans', '聖堂中殿全部歌曲'], ['sansmed', '聖堂中殿全部歌曲清晨的光落在窗邊 Morning light'], ['tiempos', 'The Nave Crossing']];

export function SpaceShell() {
  const root = useRef<HTMLDivElement>(null), [ready, setReady] = useState(false), [cfg, setCfg] = useState<{ open: boolean; section?: string }>({ open: false }), [gen, setGen] = useState(0);
  const world = useRef<{ dispose(): void; takePointer(): void } | null>(null);
  const lang = useStore(langStore, x => x.lang), lite = useStore(settings, x => x.gfx === 'lite');
  useEffect(() => boot(() => setReady(true)), []);
  useEffect(() => {
    if (!ready || !root.current) return;
    let gone = false;
    Promise.all(FACES.map(([k, t]) => ensureFont(k, t).catch(() => {}))).then(() => {
      if (gone) return;
      world.current = createWorld(createBind(), { openSettings: (section) => setCfg({ open: true, section }), closeSettings: () => setCfg(c => c.open ? { open: false } : c),
        // a lost graphics context: a fresh canvas and scene a moment later (the HUD remounts with it)
        lost: () => setTimeout(() => setGen(g => g + 1), 600) });
    });
    return () => { gone = true; world.current?.dispose(); world.current = null; };
  }, [ready, lang, gen]);
  const close = () => { setCfg({ open: false }); world.current?.takePointer(); };
  return (
    <div className={`space-root ${s.space}${cfg.open ? ' space-cfg' : ''}${lite ? ' space-lite' : ''}`} data-test="space">
      {/* a language change rebuilds the HUD and the scene's labels */}
      {ready && <div key={lang + ':' + gen} ref={root} className={s.hud} dangerouslySetInnerHTML={{ __html: hudHtml() }} />}
      {ready && cfg.open && <SpaceSettings section={cfg.section} onClose={close} />}
    </div>
  );
}
