// The classic appearance's own dialogs, beside the shared ones (ui/dialogs.tsx: a name, a yes or no, a song's
// information): a playlist to add to, exporting a song, binding a song's MV, the play page's settings.
import { useState } from 'react';
import { tx } from '../../i18n';
import { Lib, type Track } from '../bridge';
import { ui, lib, useStore, keep, toast } from '../state';
import { Button, Seg, Cover } from '../ui/kit';
import { openDialog as open, closeDialog as close, DialogHead as Head, addDialogs } from '../ui/dialogs';
import { engine } from '../playback/stage';
import { player, playIds } from '../playback/player';
import { bindMv, setMvOffset } from '../playback/mv';
import { fxAspect, FX_ASPECTS, setFxAspect, wholeRhythm, waitForVisual } from '../playback/visual';
import { ExportPanel, exportBusy } from './panes';
import { LyricsTab } from './Effect';
import { Row, Slider, Check, Select } from '../ui/kit';
import { FontPicker } from '../ui/fonts';
import { ensureFont } from '../../engine';
import { canEdit, useEditing } from '../editing';
import { EditControls, EditModeButton } from '../ui/EditModeButton';
import s from '../ui/dialogs.module.css';
export { ModalHost, askText, editMeta, askConfirm } from '../ui/dialogs';
const NP_FONT_EXTRA = (): [string, string][] => [['ui', tx('np.font.ui')]];

export const pickPlaylist = (ids: string[]) => open<string>({ kind: 'playlist', ids });
export const askMv = () => open<boolean>({ kind: 'mv' });
export const askMvOffset = () => open<boolean>({ kind: 'mvOffset' });
/** The play page's own settings: its lyrics (edit, search online, timing) and how they are shown. */
export const npSettings = (tab: 'lyrics' | 'view' = 'lyrics') =>
  tab === 'lyrics' && !canEdit() ? Promise.resolve(null) : open<boolean>({ kind: 'np', tab });
/** Export a library song as a video: it is opened (paused) with everything bound to it, then the export dialog. */
export async function exportTrack(t: Track, list?: Track[]) {
  if (t.protected) return;
  if (player.get().shownId !== t.id) {
    const ids = (list || [t]).filter((x) => !x.protected).map((x) => x.id);
    await playIds(ids, ids.indexOf(t.id), { play: false });
  } else engine.pause();
  if (!(await waitForVisual(t.id))) return;
  open({ kind: 'export' });
}

/** What the play page can be drawn over: the song's own ambient field, or one of Folia's backgrounds. */
const NP_BACKDROPS = ['ambient', 'f-common', 'f-latent', 'f-sora', 'f-monet', 'f-nomand'];
function NpModal({ m }: { m: { tab: string } }) {
  const editing = useEditing();
  const [tab, setTab] = useState(m.tab),
    o = useStore(ui, (x) => x.npLyr),
    set = (k: Partial<typeof o>) => {
      if (!canEdit()) return;
      const v = { ...o, ...k };
      ui.set({ npLyr: v });
      keep('npLyr', v);
    }; // (kept: the page reads them again next time)
  const session = useStore(player, (x) => x.session);
  return (
    <>
      <Head title={tx('np.set')} />
      {!editing && (
        <>
          <p className={s.help}>{tx('edit.required')}</p>
          <EditModeButton />
        </>
      )}
      <Seg
        fit
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          ['lyrics', tx('np.lyrics')],
          ['view', tx('np.view')],
        ]}
      />
      {tab === 'lyrics' && session && (
        <div className={s.npBody}>
          <LyricsTab />
        </div>
      )}
      <EditControls>
        {tab === 'view' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Select
              label={tx('np.bg')}
              value={o.bg || 'ambient'}
              options={NP_BACKDROPS.map((v) => [v, tx(v === 'ambient' ? 'np.bg.ambient' : 'bg.' + v)])}
              onChange={(v) => set({ bg: v })}
            />
            <div className={s.field}>
              <span>{tx('np.font')}</span>
              <FontPicker
                label={tx('np.font')}
                value={o.font || 'ui'}
                extra={NP_FONT_EXTRA()}
                onChange={async (v) => {
                  const ss = player.get().session;
                  if (v !== 'ui' && ss) await ensureFont(v, ss.doc.lines.map((L) => L.text).join(''));
                  set({ font: v });
                }}
              />
            </div>
            <Slider
              label={tx('np.size')}
              min={0.75}
              max={1.4}
              step={0.05}
              value={o.size}
              format={(v) => Math.round(v * 100) + '%'}
              onChange={(v) => set({ size: v })}
            />
            <Check label={tx('np.blur')} checked={o.blur} onChange={(v) => set({ blur: v })} />
            <Check label={tx('np.subs')} checked={o.subs} onChange={(v) => set({ subs: v })} />
            <Check label={tx('np.reads')} checked={o.reads !== false} onChange={(v) => set({ reads: v })} />
            <Row>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => set({ size: 1, blur: true, subs: true, reads: true, font: 'ui', bg: 'ambient' })}
              >
                {tx('reset.all')}
              </Button>
            </Row>
          </div>
        )}
      </EditControls>
    </>
  );
}
function PlaylistModal({ m }: { m: { ids: string[] } }) {
  const pls = useStore(lib, (x) => x.playlists);
  const add = async (id: string) => {
    await Lib!.playlist('add', id, m.ids);
    close(id);
  };
  const create = async () => {
    const id = await Lib!.playlist('create', tx('s.untitledPl'), m.ids);
    close(id);
  };
  return (
    <>
      <Head title={tx('s.addToPl')} />
      <div className={s.pick}>
        <button type="button" className={s.pickRow} onClick={create}>
          <span>+</span>
          <b>{tx('s.newPlaylist')}</b>
          <span />
        </button>
        {pls.map((p) => (
          <button key={p.id} type="button" className={s.pickRow} onClick={() => add(p.id)}>
            <span>♪</span>
            <b>{p.name}</b>
            <small>{tx('s.tracks', { n: p.tracks.length })}</small>
          </button>
        ))}
      </div>
    </>
  );
}
function ExportModal() {
  const session = useStore(player, (x) => x.session),
    t = useStore(lib, (x) => x.tracks.find((y) => y.id === player.get().shownId));
  if (!session) return null;
  return (
    <>
      <Head title={tx('s.exportMp4')} />
      <div className={s.intro}>
        <Cover k={t?.cover} />
        <div>
          <b>{t?.title}</b>
          <small>{t?.artist}</small>
        </div>
      </div>
      <p className={s.help}>{tx('s.exportHelp')}</p>
      <ExportPanel
        engine={engine}
        s={session}
        before={async () => {
          engine.pause();
          await wholeRhythm();
        }}
        aspect={{ value: fxAspect(), options: FX_ASPECTS, set: setFxAspect }}
      />
    </>
  );
}
function MvModal() {
  const t = useStore(lib, (x) => x.tracks.find((y) => y.id === player.get().shownId));
  return (
    <>
      <Head title={tx('s.mvBind')} />
      <div className={s.intro}>
        <Cover k={t?.cover} />
        <div>
          <b>{t?.title}</b>
          <small>{t?.artist}</small>
        </div>
      </div>
      <p className={s.help}>{tx('s.mvBindHelp')}</p>
      <footer className={s.foot}>
        <Button kind="ghost" onClick={() => close(false)}>
          {tx('s.cancel')}
        </Button>
        <Button
          kind="primary"
          icon="mv"
          onClick={async () => {
            const ok = await bindMv();
            close(ok);
            if (ok) toast(tx('s.mv'));
          }}
        >
          {tx('s.mvChoose')}
        </Button>
      </footer>
    </>
  );
}
function MvOffsetModal() {
  const mv = useStore(player, (x) => x.mv),
    [v, setV] = useState(String(mv.offset || 0));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMvOffset(+v || 0);
        close(true);
      }}
      style={{ display: 'grid', gap: 14 }}
    >
      <Head title={tx('s.mvOffset')} />
      <p className={s.help}>{tx('s.mvOffsetHelp')}</p>
      <label className={s.field}>
        <span>{mv.name}</span>
        <input
          type="number"
          step="0.05"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            setMvOffset(+e.target.value || 0);
          }}
        />
      </label>
      <footer className={s.foot}>
        <Button kind="primary" type="submit">
          {tx('s.done')}
        </Button>
      </footer>
    </form>
  );
}

addDialogs(
  { playlist: PlaylistModal, mv: MvModal, mvOffset: MvOffsetModal, export: ExportModal, np: NpModal },
  () => exportBusy,
);
