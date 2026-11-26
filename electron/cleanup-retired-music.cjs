const fs = require('node:fs/promises');
const path = require('node:path');
const { assertDirectory } = require('./library-storage.cjs');

const owned = ['online-accounts.json', 'online-playlists.json', 'online-download-preferences.json'];

async function cleanRetiredMusic(profile) {
  const library = path.join(profile, 'library');
  const failures = [];
  const remove = async (dir, filename) => {
    try {
      await assertDirectory(dir);
      const target = path.join(dir, filename);
      if (!(await fs.lstat(target)).isFile()) {
        failures.push(filename);
        return;
      }
      await fs.unlink(target);
    } catch (error) {
      if (error.code !== 'ENOENT') failures.push(filename);
    }
  };
  for (const filename of owned) await remove(library, filename);
  const credentials = path.join(library, 'credentials');
  try {
    await assertDirectory(credentials);
    for (const filename of await fs.readdir(credentials)) {
      if (/^music-[a-f0-9]{64}\.secret$/.test(filename)) await remove(credentials, filename);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') failures.push('credentials');
  }
  return failures;
}

module.exports = { cleanRetiredMusic };
