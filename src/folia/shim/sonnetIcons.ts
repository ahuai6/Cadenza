// Sonnet's theme icons. Upstream renders any Lucide icon a theme names through React; Cadenza's
// themes name none, so Sonnet always falls back to the Lucide flower, which is kept here as SVG
// (Lucide, ISC licence) with a few others a theme may ask for. The particle and timing helpers are
// upstream's, unchanged.
const SONNET_FALLBACK_ICON = 'Flower';

/** Lucide icon bodies (24×24 viewBox), ISC licence: https://lucide.dev */
const ICONS: Record<string, string> = {
  Flower:
    '<circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/><path d="m8 8 1.88 1.88"/><path d="M14.12 9.88 16 8"/><path d="m8 16 1.88-1.88"/><path d="M14.12 14.12 16 16"/>',
  Music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  Star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  Heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  Moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  Sparkles:
    '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
  Leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
};

export const loadSonnetIconNames = async (names: string[] | undefined): Promise<string[]> => {
  const resolved = (names ?? []).filter((n) => n in ICONS);
  return resolved.length > 0 ? resolved : [SONNET_FALLBACK_ICON];
};

// Spreads icon particles through the scene while guaranteeing every available theme icon is used.
export const buildSonnetIconParticleIndices = (
  iconCount: number,
  particleCount: number,
  seed: number,
): Array<number | null> => {
  const safeIconCount = Math.max(0, Math.floor(iconCount));
  const safeParticleCount = Math.max(0, Math.floor(particleCount));
  if (safeIconCount === 0) return Array.from({ length: safeParticleCount }, () => null);
  const iconParticleCount = Math.min(safeParticleCount, Math.max(Math.ceil(safeParticleCount / 4), safeIconCount));
  let emittedIconCount = 0;
  return Array.from({ length: safeParticleCount }, (_, index) => {
    const previousBand = Math.floor((index * iconParticleCount) / safeParticleCount);
    const currentBand = Math.floor(((index + 1) * iconParticleCount) / safeParticleCount);
    if (currentBand === previousBand) return null;
    const iconIndex = (((seed + emittedIconCount) % safeIconCount) + safeIconCount) % safeIconCount;
    emittedIconCount += 1;
    return iconIndex;
  });
};

// Distributes icon starts across most of a shot while reserving time for the final reveal.
export const resolveSonnetIconEntryPhase = (index: number, iconCount: number) => {
  const safeCount = Math.max(0, Math.floor(iconCount));
  if (safeCount <= 1) return 0.12;
  const safeIndex = Math.min(safeCount - 1, Math.max(0, Math.floor(index)));
  return 0.04 + (safeIndex / (safeCount - 1)) * 0.82;
};

export const resolveSonnetIconEntryDuration = (sceneDuration: number, preferredDuration: number) => {
  const safeSceneDuration = Math.max(0.01, sceneDuration);
  return Math.min(Math.max(0.01, preferredDuration), Math.max(0.08, safeSceneDuration * 0.18), safeSceneDuration);
};

export const resolveSonnetIconEntryDelay = (entryPhase: number, sceneDuration: number, entryDuration: number) =>
  Math.min(1, Math.max(0, entryPhase)) * Math.max(0, sceneDuration - entryDuration);

export const buildSonnetIconTextureKey = (
  name: string,
  color: string,
  strokeWidth: number,
  size: number,
  resolution: number,
) => `${name}|${color}|${strokeWidth}|${size}|${resolution}`;

/** The icon as an SVG data URL, drawn like lucide-react with `absoluteStrokeWidth`. */
export const buildSonnetIconDataUrl = (name: string, color: string, strokeWidth: number, size: number) => {
  const body = ICONS[name];
  if (!body) return null;
  const sw = (strokeWidth * 24) / Math.max(1, size);
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
};
