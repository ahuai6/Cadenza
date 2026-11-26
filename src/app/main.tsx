// Two ways in: the desktop app (the music library, the player and the workshop) or the web build (the workshop alone,
// its project kept in this browser). The desktop app has two interfaces, chosen at start by the `ui` setting: the
// classic pages or the space. The desktop lyrics and music hall have isolated entry routes.
import './styles/base.css';
import './words';
import { createRoot } from 'react-dom/client';
import { D, Lib } from './bridge';
import { pointerFocusRelease } from './focus';

pointerFocusRelease();

const root = createRoot(document.getElementById('root')!);
(async () => {
  if (location.hash === '#hall') {
    const { MusicHall } = await import('./views/hall/MusicHall');
    root.render(<MusicHall />);
    return;
  }
  // the desktop lyrics' own window (electron/desk.cjs): its lines and nothing else
  if (location.hash === '#desk') {
    const { DeskLyrics } = await import('./ui/DeskLyrics');
    root.render(<DeskLyrics />);
    return;
  }
  const mode = D && Lib ? (await D.settings().catch(() => null))?.ui : null;
  if (mode === 'space') {
    const { SpaceShell } = await import('./space/SpaceShell');
    root.render(<SpaceShell />);
    return;
  }
  if (Lib) {
    const { Shell } = await import('./views/Shell');
    root.render(<Shell />);
  } else {
    const { WebApp } = await import('./views/workshop/WebApp');
    root.render(<WebApp />);
  }
})();
