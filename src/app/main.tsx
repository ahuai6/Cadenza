// Two ways in: the desktop app (the music library, the player and the workshop) or the web build (the workshop alone,
// its project kept in this browser). The desktop app has two interfaces, chosen at start by the `ui` setting: the
// classic pages, or the space (a cathedral to walk through, src/app/space); changing it restarts the app.
import './styles/base.css';
import './words';
import { createRoot } from 'react-dom/client';
import { D, Lib } from './bridge';
import { Shell } from './views/Shell';
import { WebApp } from './views/workshop/WebApp';

const root = createRoot(document.getElementById('root')!);
(async () => {
  const mode = D && Lib ? (await D.settings().catch(() => null))?.ui : null;
  if (mode === 'space') { const { SpaceShell } = await import('./space/SpaceShell'); root.render(<SpaceShell />); return; }
  root.render(Lib ? <Shell /> : <WebApp />);
})();
