// Two ways in: the desktop app (the music library, the player and the workshop) or the web build (the workshop alone,
// its project kept in this browser).
import './styles/base.css';
import './words';
import { createRoot } from 'react-dom/client';
import { Lib } from './bridge';
import { Shell } from './views/Shell';
import { WebApp } from './views/workshop/WebApp';

createRoot(document.getElementById('root')!).render(Lib ? <Shell /> : <WebApp />);
