// Pixi's Assets loader, reduced to what Folia asks of it: load an image URL into a Texture, unload it.
import { Texture } from './texture';

const cache = new Map<string, Promise<Texture>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

export const Assets = {
  load<T = Texture>(url: string): Promise<T> {
    let p = cache.get(url);
    if (!p) {
      p = loadImage(url).then((img) => Texture.from(img));
      cache.set(url, p);
    }
    return p as unknown as Promise<T>;
  },
  async unload(url: string) {
    const p = cache.get(url);
    cache.delete(url);
    if (p) (await p.catch(() => null))?.destroy(true);
  },
};
