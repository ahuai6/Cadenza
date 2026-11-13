// The space's words live in Cadenza's one dictionary (src/i18n/dict.json) under `sp.`; this is the short way to read
// them. Words the classic interface already has are read with tx() under their own names.
import { tx } from '../../i18n';

/** A space word in the interface's language, with {n}-style values filled in. */
export const ts = (key: string, vars?: Record<string, string | number>) => tx('sp.' + key, vars);
