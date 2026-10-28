// The player's engine: one canvas, one clock. The canvas lives in the stage layer (behind the now-playing page and the
// effect lyrics); while neither is open the engine draws nothing but keeps time, so the progress bars, the lyric list and
// the queue all follow the one clock. The workshop has an engine of its own.
import { Engine, type SessionEnv } from '../../engine';
import { tx, currentLang } from '../../i18n';

let actx: AudioContext | null = null;
export const audioContext = () => (actx ||= new AudioContext({ latencyHint: 'playback' }));
export const canvas = document.createElement('canvas');
canvas.setAttribute('aria-hidden', 'true');
export const engine = new Engine(canvas, { audioContext });
export function sessionEnv(e: Engine = engine): SessionEnv {
  return { lang: currentLang(), labels: { composer: tx('end.composer'), lyricist: tx('end.lyricist'), artist: tx('end.artist') }, viewAspect: () => e.viewAspect() };
}
(window as any).__cadenza = { engine };
