import { mediaUrl } from '../bridge';

let decoder: OfflineAudioContext | null = null;
// Export and the workshop explicitly request these full PCM buffers. Chromium cannot cancel a submitted decode.
let decoding = 0;
const waiters: (() => void)[] = [];

export async function decodeFile(id: string, signal?: AbortSignal, revision?: string) {
  signal?.throwIfAborted();
  if (decoding < 2) decoding++;
  else
    await new Promise<void>((resolve, reject) => {
      const advance = () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        const i = waiters.indexOf(advance);
        if (i >= 0) waiters.splice(i, 1);
        reject(signal?.reason);
      };
      waiters.push(advance);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  try {
    signal?.throwIfAborted();
    const r = await fetch(mediaUrl(id, revision), { signal });
    if (!r.ok) throw new Error('read');
    const bytes = await r.arrayBuffer();
    signal?.throwIfAborted();
    return await (decoder ||= new OfflineAudioContext(2, 1, 48000)).decodeAudioData(bytes);
  } finally {
    const next = waiters.shift();
    if (next) next();
    else decoding--;
  }
}
