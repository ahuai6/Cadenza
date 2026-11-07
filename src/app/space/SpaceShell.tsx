// The space interface: the music library as a cathedral to walk through (docs/SPACE.md). It is the second appearance
// half of the interface: it keeps the logic half (state, actions, playback, the bridge) exactly as the classic pages do.
// Step 2a: the prototype's scene and HUD, moved as they stand, still on its demonstration data; bind.ts (step 3) puts
// the real library in.
import { useEffect, useRef, useState } from 'react';
import { boot } from '../actions/boot';
import { setSettings } from '../actions/settings';
import { D } from '../bridge';
import { tx } from '../../i18n';
import { ensureFont } from '../../engine';
import { createWorld } from './world';
import hud from './hud.html?raw';
import './space.css';
import s from './SpaceShell.module.css';

// every face the scene's textures and the HUD draw with, loaded before the first texture is drawn
const FACES: [string, string][] = [['serif', '聖堂中殿全部歌曲歌單設定播放中清晨的光'], ['notosans', '聖堂中殿全部歌曲'], ['tiempos', 'The Nave Crossing']];

export function SpaceShell() {
  const root = useRef<HTMLDivElement>(null), [ready, setReady] = useState(false);
  useEffect(() => boot(() => setReady(true)), []);
  useEffect(() => {
    if (!ready || !root.current) return;
    let world: { dispose(): void } | null = null, gone = false;
    Promise.all(FACES.map(([k, t]) => ensureFont(k, t).catch(() => {}))).then(() => { if (!gone) world = createWorld(); });
    return () => { gone = true; world?.dispose(); };
  }, [ready]);
  return (
    <div className={`space-root ${s.space}`} data-test="space">
      {ready && <div ref={root} className={s.hud} dangerouslySetInnerHTML={{ __html: hud }} />}
      {ready && <button type="button" className={s.back} onClick={async () => { await setSettings({ ui: 'classic' }); await D?.relaunch(); }}>{tx('s.set.uiMode.classic')} · {tx('s.set.uiMode.restart')}</button>}
    </div>
  );
}
