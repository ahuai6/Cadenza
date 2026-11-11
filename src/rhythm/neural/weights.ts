// The packed weight files: [tensors: manifest.bytes][manifest JSON, UTF-8]["FOLIABTW"][uint64 LE: byte offset of the
// JSON], every byte_offset in the manifest an offset into the file itself. Read here in the browser (the format is
// Folia's, electron/analysis/packedWeights.cjs: https://github.com/chthollyphile/folia-major, AGPL-3.0), each file
// checked against its SHA-256 first. Part of Cadenza, AGPL-3.0-only (LICENSE, NOTICE.md).
import MODELS from './models.json';

export type ModelName = keyof typeof MODELS.models;
export const MODEL_INFO = MODELS.models;
const MAGIC = 'FOLIABTW',
  TRAILER = MAGIC.length + 8;

export function unpackWeights<M extends { bytes: number }>(file: ArrayBuffer): { weights: Uint8Array; manifest: M } {
  const u8 = new Uint8Array(file),
    n = u8.byteLength;
  if (n < TRAILER || String.fromCharCode(...u8.subarray(n - TRAILER, n - 8)) !== MAGIC)
    throw new Error('not a packed model (no FOLIABTW trailer)');
  const at = Number(new DataView(file).getBigUint64(n - 8, true));
  if (!(at > 0 && at < n - TRAILER)) throw new Error(`manifest offset ${at} is outside the file`);
  const manifest = JSON.parse(new TextDecoder().decode(u8.subarray(at, n - TRAILER))) as M;
  if (manifest.bytes !== at) throw new Error(`the tensors are ${at} bytes, the manifest says ${manifest.bytes}`);
  return { weights: u8.subarray(0, at), manifest };
}
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
/** A model's file from `base`, unpacked; throws when it is missing, cut short or not the one the hash names. */
export async function loadModel<M extends { bytes: number }>(
  base: string,
  name: ModelName,
): Promise<{ weights: Uint8Array; manifest: M }> {
  const info = MODEL_INFO[name],
    res = await fetch(new URL(info.file, base).href);
  if (!res.ok) throw new Error(`${info.file}: ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== info.bytes) throw new Error(`${info.file}: ${buf.byteLength} bytes, expected ${info.bytes}`);
  const sum = hex(await crypto.subtle.digest('SHA-256', buf));
  if (sum !== info.sha256) throw new Error(`${info.file}: sha256 ${sum.slice(0, 12)}… does not match`);
  return unpackWeights<M>(buf);
}
