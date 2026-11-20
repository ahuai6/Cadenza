// Copied only into a disposable snapshot. Refuse to launch if the profile is outside it.
const fs = require('node:fs');
const path = require('node:path');
const { app, globalShortcut } = require('electron');

const root = process.env.CADENZA_BASELINE_ROOT;
const profile = process.env.CADENZA_USER_DATA;
if (!root || !profile || process.argv.includes('--reset-data'))
  throw new Error('An isolated baseline profile is required');
const relative = path.relative(fs.realpathSync(root), fs.realpathSync(profile));
if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
  throw new Error('The profile is outside the baseline directory');

app.setPath('userData', profile);
app.setPath('sessionData', profile);
// The regression suite may use these features, but a baseline must not change the user's Windows settings.
app.setLoginItemSettings = () => {};
globalShortcut.register = () => false;
