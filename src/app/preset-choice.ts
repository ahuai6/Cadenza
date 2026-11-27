import type { Session } from '../engine';
import { MOTIONS, PRESETS } from '../theme/style';
import { motions } from './motions';
import { themes } from './themes';

export type PresetChoice = { kind: 'look' | 'theme' | 'motion' | 'saved-motion'; id: string };

export function applyExistingPreset(session: Session, choice: PresetChoice) {
  if (choice.kind === 'look' && Object.hasOwn(PRESETS, choice.id)) {
    if (session.custom) session.applyLook(choice.id);
    else session.applyPreset(choice.id);
    return true;
  }
  if (choice.kind === 'theme') {
    const entry = themes.get().list.find((t) => t.id === choice.id);
    if (!entry) return false;
    return session.applyTheme(entry.style, { id: entry.id, name: entry.name });
  }
  if (choice.kind === 'motion' && Object.hasOwn(MOTIONS, choice.id)) {
    if (!session.custom) session.makeCustom();
    return session.applyMotion(choice.id);
  }
  if (choice.kind === 'saved-motion') {
    const entry = motions.get().list.find((m) => m.id === choice.id);
    if (!entry) return false;
    if (!session.custom) session.makeCustom();
    return session.applySavedMotion(entry.motion, entry.id, entry.name);
  }
  return false;
}
