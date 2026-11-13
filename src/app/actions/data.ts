// The library's stored data, kept by the desktop app: every song's rhythm read again, the stored data (rhythm, covers'
// thumbnails, loudness) cleared, or everything reset so the app starts afresh. Both interfaces ask first (each in its
// own way), then call these.
import { Lib } from '../bridge';

export async function readAllRhythmsAgain() {
  if (!Lib) return;
  await Lib.reanalyze('all');
  Lib.rescan();
}
export async function clearStoredData() {
  if (!Lib) return;
  await Lib.clearCaches();
  Lib.rescan();
}
export function resetEverything() {
  Lib?.resetAll();
}
