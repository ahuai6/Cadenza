// Changing the settings: saved by the desktop app, then applied where they act (the audio route, the volume balance,
// the engine's configuration). The one way any interface changes a setting.
import { setLang as setI18n, words, type Lang } from '../../i18n';
import { D, type Settings } from '../bridge';
import { settings } from '../state';
import { engine } from '../playback/stage';
import { switchOutput, applyBalance } from '../playback/player';
import { applyEngineConfig } from '../engineConfig';
import { applyUiFont } from '../uifont';
import { canEdit } from '../editing';

export async function setSettings(patch: Partial<Settings>) {
  if (!canEdit() && Object.keys(patch).some((k) => ['mvDark', 'mvBlur', 'mvDesat', 'mvFit'].includes(k))) return;
  settings.set(patch);
  const save = async () => {
    const n = D ? await D.setSettings(patch) : { ...settings.get(), ...patch };
    settings.set(n);
    return n;
  };
  const n =
    'audioOut' in patch || 'audioMode' in patch || 'audioDevice' in patch ? await switchOutput(save) : await save();
  if ('fixedVolume' in patch) engine.setVolume(engine.volume);
  if ('volBalance' in patch || 'fixedVolume' in patch) applyBalance();
  applyEngineConfig(n, Object.keys(patch));
}
/** The interface language (its font and its words), saved. */
export async function setLang(l: Lang) {
  await applyUiFont(l, undefined, words(l));
  setI18n(l);
  settings.set({ lang: l });
  await D?.setSettings({ lang: l });
}
