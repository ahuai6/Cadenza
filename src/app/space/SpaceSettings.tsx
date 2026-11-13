// The space's settings page: a glass card over the cathedral (the renderer draws the glass behind every .card). The
// walking keys and immersive mode live here (no guide card in the room); the rest are the space's own settings and the
// handful of Cadenza's the room needs at hand. Everything is saved to Cadenza's settings, so both interfaces share it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tx, LANGS, currentLang, type Lang } from '../../i18n';
import { settings, lib, useStore } from '../state';
import { Lib, D, type Settings } from '../bridge';
import { setSettings, setLang } from '../actions/settings';
import { readAllRhythmsAgain, clearStoredData, resetEverything } from '../actions/data';
import { Button, Dropdown } from '../ui/kit';
import { FontPicker } from '../ui/fonts';
import { SettingField } from '../ui/SettingField';
import type { SettingKey } from '../settings/schema';
import { ts } from './i18n';
import s from './SpaceSettings.module.css';

export type SpaceSection = 'guide' | 'light' | 'audio' | 'lyrics' | 'look' | 'library' | 'data';

const Group = ({ id, title, children }: { id: SpaceSection; title: string; children: ReactNode }) => (
  <section className={s.group} data-section={id}>
    <h3>{title}</h3>
    <div className={s.body}>{children}</div>
  </section>
);
const Field = ({ label, help, children }: { label: string; help?: string; children: ReactNode }) => (
  <div className={s.field}>
    <div>
      <span>{label}</span>
      {help && <small>{help}</small>}
    </div>
    {children}
  </div>
);
/** Settings drawn from their declarations (settings/schema.ts), in this card's rows. */
const fields = (...keys: SettingKey[]) =>
  keys.map((k) => (
    <SettingField
      key={k}
      k={k}
      fit={false}
      frame={({ label, help, children }) => (
        <Field label={label} help={help}>
          {children}
        </Field>
      )}
    />
  ));
/** A stored-data action, asked about in place (the space has no dialogs): its button, then what it does and a yes. */
function Ask({ k, act, danger, icon }: { k: string; act: () => unknown; danger?: boolean; icon?: string }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  if (!open)
    return (
      <div>
        <Button size="sm" kind={danger ? 'danger' : undefined} icon={icon} onClick={() => setOpen(true)}>
          {tx(`s.set.data.${k}`)}
        </Button>
      </div>
    );
  return (
    <div className={s.ask} data-test={`ask-${k}`}>
      <p>{tx(`s.set.data.${k}Ask`)}</p>
      <div className={s.row}>
        <Button
          size="sm"
          kind={danger ? 'danger' : 'primary'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await act();
            setBusy(false);
            setOpen(false);
          }}
        >
          {tx(`s.set.data.${k}Yes`)}
        </Button>
        <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>
          {tx('s.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function SpaceSettings({ section, onClose }: { section?: string; onClose: () => void }) {
  const st = useStore(settings),
    folders = useStore(lib, (x) => x.folders),
    body = useRef<HTMLDivElement>(null);
  const set = (p: Partial<Settings>) => {
    setSettings(p);
  };
  // (only the list scrolls to the section: scrollIntoView would scroll every box around it too)
  useEffect(() => {
    const box = body.current,
      el = section ? box?.querySelector<HTMLElement>(`[data-section="${section}"]`) : null;
    if (box && el) box.scrollTo({ top: el.offsetTop - box.offsetTop, behavior: 'smooth' });
  }, [section]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <section className={`hud card ${s.panel}`} aria-label={ts('s.title')} data-test="space-settings">
      <header className={s.head}>
        <h2>{ts('s.title')}</h2>
        <button type="button" className={s.close} onClick={onClose} aria-label={ts('close')}>
          ✕
        </button>
      </header>
      <div className={s.scroll} ref={body}>
        <Group id="guide" title={ts('g.guide')}>
          <ul className={s.keys}>
            {['k.look', 'k.walk', 'k.wall', 'k.pages', 'k.sit', 'k.keys'].map((k) => (
              <li key={k}>{ts(k)}</li>
            ))}
          </ul>
          {fields('spaceImmersive', 'spaceFollow', 'spaceWalk', 'spaceLook', 'spaceReduced')}
        </Group>
        <Group id="light" title={ts('g.light')}>
          {fields('spaceTint')}
          {st.spaceTint === 'fixed' && (
            <Field label={ts('tint.pick')}>
              <input
                className={s.color}
                type="color"
                value={st.spaceTintColor || '#D97757'}
                onChange={(e) => set({ spaceTintColor: e.target.value })}
                aria-label={ts('tint.pick')}
              />
            </Field>
          )}
          {/* the scene's response: four plain knobs (100% is as designed) */}
          {fields(
            'spaceBeams',
            'spaceBeatBeams',
            'spacePulse',
            'spaceFxBeat',
            'spaceFxPulse',
            'spaceFxTint',
            'spaceFxBeams',
            'spaceDream',
            'spaceLine',
            'spaceShadow',
            'gfx',
            'spaceScale',
          )}
        </Group>
        <Group id="audio" title={ts('g.audio')}>
          {fields('audioOut', 'volBalance', 'spaceAmbient', 'spaceAmbientVol')}
        </Group>
        <Group id="lyrics" title={ts('g.lyrics')}>
          <Field label={ts('lyricFont')} help={ts('lyricFont.help')}>
            <FontPicker
              label={ts('lyricFont')}
              value={st.spaceFont || 'sansmed'}
              onChange={(v) => set({ spaceFont: v })}
            />
          </Field>
          {fields('fxCapSubs', 'fxCapReads', 'spaceLyric')}
        </Group>
        <Group id="look" title={ts('g.look')}>
          {fields('ui')}
          <div>
            <Button size="sm" icon="refresh" onClick={() => D?.relaunch()}>
              {tx('s.set.uiMode.restart')}
            </Button>
          </div>
          <Field label={tx('s.set.lang')}>
            <Dropdown
              value={currentLang()}
              options={LANGS.map(([k, n]) => [k, n] as [string, string])}
              onChange={(v) => setLang(v as Lang)}
            />
          </Field>
        </Group>
        <Group id="library" title={ts('g.library')}>
          <ul className={s.folders}>
            {folders.map((f) => (
              <li key={f}>
                <span title={f}>{f}</span>
                <button
                  type="button"
                  onClick={() => Lib?.removeFolder(f).then((v) => lib.set(v))}
                  aria-label={tx('remove')}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className={s.row}>
            <Button size="sm" icon="plus" onClick={() => Lib?.addFolder().then((v) => lib.set(v))}>
              {tx('s.addFolder')}
            </Button>
            <Button size="sm" icon="refresh" onClick={() => Lib?.rescan()}>
              {tx('s.set.rescan')}
            </Button>
          </div>
        </Group>
        <Group id="data" title={tx('s.set.data')}>
          <p className={s.note}>{tx('s.set.dataHelp')}</p>
          <Ask k="reanalyze" icon="refresh" act={readAllRhythmsAgain} />
          <Ask k="caches" act={clearStoredData} />
          <Ask k="reset" danger act={resetEverything} />
        </Group>
      </div>
    </section>
  );
}
