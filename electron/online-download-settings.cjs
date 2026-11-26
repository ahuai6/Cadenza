const fields = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'number',
  'trackCount',
  'disc',
  'discCount',
  'year',
  'genre',
  'composer',
  'copyright',
  'isrc',
  'cover',
];
const defaults = Object.freeze({
  fields: ['title', 'artist', 'album', 'cover'],
  lyric: 'native',
  lyricFile: 'embedded',
  languageTracks: ['translation', 'transliteration'],
  naming: 'artist-title',
  conflict: 'keep',
  importTrack: true,
});
const options = {
  lyric: ['native', 'lrc', 'none'],
  lyricFile: ['embedded', 'external', 'both'],
  naming: ['artist-title', 'title', 'numbered'],
  conflict: ['keep', 'skip'],
};
function settingsPatch(input) {
  const patch = {};
  if (Array.isArray(input?.fields)) patch.fields = fields.filter((field) => input.fields.includes(field));
  if (Array.isArray(input?.languageTracks))
    patch.languageTracks = ['translation', 'transliteration'].filter((field) => input.languageTracks.includes(field));
  for (const [key, values] of Object.entries(options)) {
    if (values.includes(input?.[key])) patch[key] = input[key];
  }
  if (typeof input?.importTrack === 'boolean') patch.importTrack = input.importTrack;
  return patch;
}
function downloadSettings(global, platform, once) {
  return { ...defaults, ...settingsPatch(global), ...settingsPatch(platform), ...settingsPatch(once) };
}

module.exports = { downloadSettings, settingsPatch };
