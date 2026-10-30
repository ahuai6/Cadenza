// Dialogs: a name, a playlist to add to, a song's information (edit, MusicBrainz tags, cover), exporting a song, binding
// a song's MV. Each opens through a function that resolves with the answer.
import { useEffect, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { Lib, type Track, type MetaFound, type CoverFound } from '../bridge';
import { ui, lib, useStore, fmtTime, toast } from '../state';
import { Button, IconButton, Seg, Cover, Badge, usePresence } from '../ui/kit';
import { engine } from '../playback/stage';
import { player, playIds, bindMv, setMvOffset } from '../playback/player';
import { ExportPanel, exportBusy } from './panes';
import { LyricsTab } from './Effect';
import { Row, Slider, Check } from '../ui/kit';
import s from './Modals.module.css';

let resolver: ((v: unknown) => void) | null = null;
function open<T>(modal: { kind: string; [k: string]: unknown }): Promise<T | null> { resolver?.(null); return new Promise(res => { resolver = res as (v: unknown) => void; ui.set({ modal }); }); }
function close(v: unknown) { ui.set({ modal: null }); const r = resolver; resolver = null; r?.(v); }

export const askText = (title: string, label: string, value: string) => open<string>({ kind: 'text', title, label, value });
export const pickPlaylist = (ids: string[]) => open<string>({ kind: 'playlist', ids });
export const editMeta = (t: Track) => open<boolean>({ kind: 'meta', id: t.id });
export const askMv = () => open<boolean>({ kind: 'mv' });
/** A yes or no to something that cannot be undone (`danger`: the yes button is red). */
export const askConfirm = (title: string, text: string, yes: string, danger = false) => open<boolean>({ kind: 'confirm', title, text, yes, danger });
export const askMvOffset = () => open<boolean>({ kind: 'mvOffset' });
/** The play page's own settings: its lyrics (edit, search online, timing) and how they are shown. */
export const npSettings = (tab: 'lyrics' | 'view' = 'lyrics') => open<boolean>({ kind: 'np', tab });
/** Export a library song as a video: it is opened (paused) with everything bound to it, then the export dialog. */
export async function exportTrack(t: Track, list?: Track[]) {
  if (t.protected) return;
  if (player.get().shownId !== t.id) { const ids = (list || [t]).filter(x => !x.protected).map(x => x.id); await playIds(ids, ids.indexOf(t.id), { play: false }); }
  else engine.pause();
  if (player.get().shownId !== t.id) return;
  open({ kind: 'export' });
}

export function ModalHost() {
  const m = useStore(ui, x => x.modal), last = useRef(m); if (m) last.current = m;
  const { shown, closing } = usePresence(!!m), cur = m || last.current;
  useEffect(() => { if (!m && resolver) { const r = resolver; resolver = null; r(null); } }, [m]);
  if (!shown || !cur) return null;
  const Body = ({ text: TextModal, playlist: PlaylistModal, meta: MetaModal, mv: MvModal, mvOffset: MvOffsetModal, export: ExportModal, np: NpModal, confirm: ConfirmModal } as Record<string, (p: { m: any }) => React.ReactElement | null>)[cur.kind];
  return (
    // (closing: the dialog and its scrim fade out quickly, nothing taking clicks meanwhile)
    <div className={s.scrim + ' ' + (ui.get().layer !== 'none' ? 'on-picture' : '')} data-closing={closing || undefined} onPointerDown={e => { if (e.target === e.currentTarget && !exportBusy) close(null); }}>
      <div data-test="modal" className={s.modal} role="dialog" aria-modal="true" data-kind={cur.kind}><Body m={cur} /></div>
    </div>
  );
}
function NpModal({ m }: { m: { tab: string } }) {
  const [tab, setTab] = useState(m.tab), o = useStore(ui, x => x.npLyr), set = (k: Partial<typeof o>) => ui.set({ npLyr: { ...o, ...k } });
  const session = useStore(player, x => x.session);
  return (
    <>
      <Head title={tx('np.set')} />
      <Seg fit size="sm" value={tab} onChange={setTab} options={[['lyrics', tx('np.lyrics')], ['view', tx('np.view')]]} />
      {tab === 'lyrics' && session && <div className={s.npBody}><LyricsTab /></div>}
      {tab === 'view' && <div style={{ display: 'grid', gap: 12 }}>
        <Slider label={tx('np.size')} min={0.75} max={1.4} step={0.05} value={o.size} format={v => Math.round(v * 100) + '%'} onChange={v => set({ size: v })} />
        <Check label={tx('np.blur')} checked={o.blur} onChange={v => set({ blur: v })} />
        <Check label={tx('np.subs')} checked={o.subs} onChange={v => set({ subs: v })} />
        <Row><Button kind="ghost" size="sm" onClick={() => set({ size: 1, blur: true, subs: true })}>{tx('reset.all')}</Button></Row>
      </div>}
    </>
  );
}
const Head = ({ title }: { title: string }) => <header className={s.head}><h2>{title}</h2><IconButton n="close" size="sm" label={tx('s.close')} onClick={() => close(null)} /></header>;

function ConfirmModal({ m }: { m: { title: string; text: string; yes: string; danger: boolean } }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Head title={m.title} />
      <p className={s.help}>{m.text}</p>
      <footer className={s.foot}><Button kind="ghost" onClick={() => close(false)}>{tx('s.cancel')}</Button><Button kind={m.danger ? 'danger' : 'primary'} autoFocus onClick={() => close(true)}>{m.yes}</Button></footer>
    </div>
  );
}
function TextModal({ m }: { m: { title: string; label: string; value: string } }) {
  const [v, setV] = useState(m.value || ''), ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form onSubmit={e => { e.preventDefault(); close(v.trim()); }} style={{ display: 'grid', gap: 14 }}>
      <Head title={m.title} />
      <label className={s.field}><span>{m.label}</span><input ref={ref} type="text" value={v} onChange={e => setV(e.target.value)} maxLength={80} /></label>
      <footer className={s.foot}><Button kind="ghost" onClick={() => close(null)}>{tx('s.cancel')}</Button><Button kind="primary" type="submit">{tx('s.done')}</Button></footer>
    </form>
  );
}
function PlaylistModal({ m }: { m: { ids: string[] } }) {
  const pls = useStore(lib, x => x.playlists);
  const add = async (id: string) => { await Lib!.playlist('add', id, m.ids); close(id); };
  const create = async () => { const id = await Lib!.playlist('create', tx('s.untitledPl'), m.ids); close(id); };
  return (
    <>
      <Head title={tx('s.addToPl')} />
      <div className={s.pick}>
        <button type="button" className={s.pickRow} onClick={create}><span>+</span><b>{tx('s.newPlaylist')}</b><span /></button>
        {pls.map(p => <button key={p.id} type="button" className={s.pickRow} onClick={() => add(p.id)}><span>♪</span><b>{p.name}</b><small>{tx('s.tracks', { n: p.tracks.length })}</small></button>)}
      </div>
    </>
  );
}

// a song's information: edit it by hand, take tags from MusicBrainz, or find a cover, each on its own. Everything is kept
// in the library; the audio file is never rewritten, and every part can go back to what the file says
function MetaModal({ m }: { m: { id: string; tab?: string } }) {
  const t = useStore(lib, x => x.tracks.find(y => y.id === m.id)), [tab, setTab] = useState(m.tab || 'edit');
  if (!t) return null;
  return (
    <>
      <Head title={tx('s.meta')} />
      <div className={s.top}>
        <Cover k={t.cover} />
        <div><b>{t.title}</b><small>{[t.artist, t.album].filter(Boolean).join(' — ') || t.file}</small></div>
        <Seg size="sm" fit role="tablist" value={tab} onChange={setTab} options={[['edit', tx('s.meta.edit'), 'lyrics'], ['tags', tx('s.meta.tags'), 'tag'], ['cover', tx('s.meta.cover'), 'image']]} />
      </div>
      {tab === 'edit' && <EditTab t={t} />}
      {tab === 'tags' && <TagsTab t={t} />}
      {tab === 'cover' && <CoverTab t={t} />}
    </>
  );
}
const FIELDS: [keyof Track['tags'], string, number][] = [['title', 's.col.title', 2], ['artist', 's.f.artist', 1], ['album', 's.col.album', 1], ['albumArtist', 's.f.albumArtist', 1], ['genre', 's.f.genre', 1], ['year', 's.f.year', 0], ['track', 's.f.track', 0], ['disc', 's.f.disc', 0]];
const asText = (v: unknown) => Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
function EditTab({ t }: { t: Track }) {
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, asText((t as any)[k])])) as Record<string, string>);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); await Lib!.editMeta(t.id, f); setBusy(false); toast(tx('s.meta.saved')); close(true); };
  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <div className={s.grid}>{FIELDS.map(([k, label, w]) => (
        <label key={k} className={s.field} data-w={w}><span>{tx(label)}</span>
          <input type={k === 'year' || k === 'track' || k === 'disc' ? 'number' : 'text'} min="0" value={f[k]} placeholder={asText(t.tags && t.tags[k])} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>))}</div>
      <p className={s.help}>{tx('s.meta.editHelp')}</p>
      <footer className={s.foot}>
        {t.edited && <Button kind="ghost" onClick={async () => { await Lib!.clearMeta(t.id, 'tags'); toast(tx('s.meta.restored')); close(true); }}>{tx('s.lookupReset')}</Button>}
        <span className="grow" />
        <Button kind="ghost" onClick={() => close(null)}>{tx('s.cancel')}</Button>
        <Button kind="primary" type="submit" disabled={busy}>{tx('s.save')}</Button>
      </footer>
    </form>
  );
}
function TagsTab({ t }: { t: Track }) {
  const [q, setQ] = useState({ title: t.title, artist: t.artist, album: t.album }), [res, setRes] = useState<MetaFound[] | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const search = async () => { setBusy(true); setErr(''); try { setRes(await Lib!.searchMeta(q)); } catch { setErr(tx('s.netFail')); } setBusy(false); };
  useEffect(() => { search(); }, []);
  const apply = async (r: MetaFound) => { setBusy(true); try { await Lib!.applyMeta(t.id, r); toast(tx('s.meta.saved')); close(true); } catch { setErr(tx('s.netFail')); setBusy(false); } };
  return (
    <>
      <p className={s.help}>{tx('s.lookupHelp')}</p>
      <form className={s.q} onSubmit={e => { e.preventDefault(); search(); }}>
        <input type="text" value={q.title} placeholder={tx('s.col.title')} onChange={e => setQ({ ...q, title: e.target.value })} />
        <input type="text" value={q.artist} placeholder={tx('s.artists')} onChange={e => setQ({ ...q, artist: e.target.value })} />
        <input type="text" value={q.album} placeholder={tx('s.col.album')} onChange={e => setQ({ ...q, album: e.target.value })} />
        <Button kind="primary" type="submit" icon="search" disabled={busy}>{tx('s.searchBtn')}</Button>
      </form>
      <div className={s.results}>
        {busy && !res && <p className="muted">{tx('s.searching')}</p>}
        {err && <p className="muted">{err}</p>}
        {res && !res.length && <p className="muted">{tx('s.empty.results')}</p>}
        {res && res.map(r => (
          <button key={r.mbid} type="button" className={s.result} disabled={busy} onClick={() => apply(r)}>
            <span><b>{r.title}</b><small>{[r.artist, r.album, r.year].filter(Boolean).join(' · ')}</small></span>
            <span>{r.genre && r.genre.length ? <Badge>{r.genre.join(', ')}</Badge> : null} {r.duration ? <small className="muted">{fmtTime(r.duration)}</small> : null}</span>
          </button>
        ))}
      </div>
    </>
  );
}
function CoverTab({ t }: { t: Track }) {
  const [q, setQ] = useState({ album: t.album || t.title, artist: t.artist }), [res, setRes] = useState<CoverFound[] | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [picking, setPicking] = useState<string | null>(null);
  const search = async () => { setBusy(true); setErr(''); setRes(null); try { setRes(await Lib!.searchCovers(q)); } catch { setErr(tx('s.netFail')); } setBusy(false); };
  useEffect(() => { search(); }, []);
  const use = async (how: { url?: string; file?: boolean; reset?: boolean }) => { setPicking(how.url || 'file'); try { const ok = await Lib!.setCover(t.id, how); if (ok) { toast(tx('s.meta.coverSet')); close(true); } } catch { setErr(tx('s.netFail')); } setPicking(null); };
  return (
    <>
      <p className={s.help}>{tx('s.meta.coverHelp')}</p>
      <form className={s.q} data-n="2" onSubmit={e => { e.preventDefault(); search(); }}>
        <input type="text" value={q.album} placeholder={tx('s.col.album')} onChange={e => setQ({ ...q, album: e.target.value })} />
        <input type="text" value={q.artist} placeholder={tx('s.artists')} onChange={e => setQ({ ...q, artist: e.target.value })} />
        <Button kind="primary" type="submit" icon="search" disabled={busy}>{tx('s.searchBtn')}</Button>
      </form>
      <div className={s.covers}>
        {busy && <p className="muted">{tx('s.searching')}</p>}
        {err && <p className="muted">{err}</p>}
        {res && !res.length && <p className="muted">{tx('s.meta.noCovers')}</p>}
        {res && res.map((c, i) => (
          <button key={i} type="button" className={s.coverPick} disabled={!!picking} data-busy={picking === c.full} onClick={() => use({ url: c.full })} title={[c.title, c.artist, c.year].filter(Boolean).join(' · ')}>
            <img src={c.thumb} alt="" draggable={false} /><b>{c.title}</b><small>{[c.artist, c.year].filter(Boolean).join(' · ')}</small><Badge>{c.src === 'itunes' ? 'iTunes' : 'Cover Art Archive'}</Badge>
          </button>
        ))}
      </div>
      <footer className={s.foot}>
        {t.coverSet && <Button kind="ghost" onClick={() => use({ reset: true })}>{tx('s.meta.resetCover')}</Button>}
        <span className="grow" />
        <Button icon="folder" disabled={!!picking} onClick={() => use({ file: true })}>{tx('s.meta.fromFile')}</Button>
      </footer>
    </>
  );
}
function ExportModal() {
  const session = useStore(player, x => x.session), t = useStore(lib, x => x.tracks.find(y => y.id === player.get().shownId));
  if (!session) return null;
  return (
    <>
      <Head title={tx('s.exportMp4')} />
      <div className={s.intro}><Cover k={t?.cover} /><div><b>{t?.title}</b><small>{t?.artist}</small></div></div>
      <p className={s.help}>{tx('s.exportHelp')}</p>
      <ExportPanel engine={engine} s={session} before={() => engine.pause()} />
    </>
  );
}
function MvModal() {
  const t = useStore(lib, x => x.tracks.find(y => y.id === player.get().shownId));
  return (
    <>
      <Head title={tx('s.mvBind')} />
      <div className={s.intro}><Cover k={t?.cover} /><div><b>{t?.title}</b><small>{t?.artist}</small></div></div>
      <p className={s.help}>{tx('s.mvBindHelp')}</p>
      <footer className={s.foot}>
        <Button kind="ghost" onClick={() => close(false)}>{tx('s.cancel')}</Button>
        <Button kind="primary" icon="mv" onClick={async () => { const ok = await bindMv(); close(ok); if (ok) toast(tx('s.mv')); }}>{tx('s.mvChoose')}</Button>
      </footer>
    </>
  );
}
function MvOffsetModal() {
  const mv = useStore(player, x => x.mv), [v, setV] = useState(String(mv.offset || 0));
  return (
    <form onSubmit={e => { e.preventDefault(); setMvOffset(+v || 0); close(true); }} style={{ display: 'grid', gap: 14 }}>
      <Head title={tx('s.mvOffset')} />
      <p className={s.help}>{tx('s.mvOffsetHelp')}</p>
      <label className={s.field}><span>{mv.name}</span><input type="number" step="0.05" value={v} onChange={e => { setV(e.target.value); setMvOffset(+e.target.value || 0); }} /></label>
      <footer className={s.foot}><Button kind="primary" type="submit">{tx('s.done')}</Button></footer>
    </form>
  );
}
