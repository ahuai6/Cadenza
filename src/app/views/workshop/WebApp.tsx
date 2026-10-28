// The web build: the workshop on its own, in the system's light or dark appearance and language.
import { useLayoutEffect } from 'react';
import { detectLang, setLang, LANGS, lang as langStore, type Lang } from '../../../i18n';
import { useStore } from '../../state';
import { applyUiFont } from '../../uifont';
import { ContextMenu, Toast } from '../../ui/kit';
import { Workshop } from './Workshop';

const saved = (() => { try { return localStorage.getItem('cz-lang'); } catch { return null; } })();
const first = (saved && LANGS.some(([k]) => k === saved) ? saved : detectLang()) as Lang;
applyUiFont(first); setLang(first);
export function WebApp() {
  const l = useStore(langStore, x => x.lang);
  useLayoutEffect(() => { const mq = matchMedia('(prefers-color-scheme: dark)'), apply = () => { document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'; }; apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply); }, []);
  return <div key={l} style={{ position: 'fixed', inset: 0 }}><Workshop web /><ContextMenu /><Toast /></div>;
}
