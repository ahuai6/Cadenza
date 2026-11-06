// The settings of a lyric video, shared by a song's panel (in the effect view) and the workshop. Every pane works on a
// Session through `edit`, so the session replans what a change affects and the caller keeps the change (bound to the
// song, or in the workshop's project). The effect list is built from the effect registry: a new effect module with a
// parameter schema shows up here with its own controls, without touching this file.
import { useEffect, useRef, useState } from 'react';
import { tx } from '../../i18n';
import type { Engine, Session } from '../../engine';
import { exportVideo, estimate, blobSink } from '../../engine';
import { PRESETS, KNOBS, MACROS, MOTIONS, KNOB_REBUILD, motionOf, presetStyle, type Style } from '../../theme/style';
import { effects, LYRIC_TYPES, type EffectParam as Param } from '../../engine';
import { desktop, offerFile, pickSavePath, fileSink, D } from '../bridge';
import { remember, keep, toast } from '../state';
import { Button, Section, Row, Select, Slider, Check, TextField, Note, kit } from '../ui/kit';
import { ColorField } from '../ui/color';
import { FontPicker } from '../ui/fonts';
import { useThemes, saveTheme, deleteTheme } from '../themes';
import { useMotions, saveMotion, deleteMotion } from '../motions';
import { pauseAnalysis } from '../playback/analysis';
import s from './panes.module.css';

export type Edit = (fn: (s: Session) => unknown) => void;
export interface PaneProps { s: Session; edit: Edit; ctx: 'song' | 'workshop' }
export const BG_STYLES = ['cover', 'vinyl', 'liquid', 'gothic', 'stage', 'minimal', 'solid', 'bokeh', 'geo', 'video'];
const COVER_EDGE = ['album', 'float', 'blend'], ASPECTS: [string, string][] = [['16:9', 'aspect.169'], ['9:16', 'aspect.916'], ['1:1', 'aspect.11'], ['4:5', 'aspect.45'], ['fill', 'aspect.fill']];
const CUTS = ['punch', 'waltz', 'glide', 'close', 'hover', 'center'], TIN = ['mix', 'blur', 'drift', 'rise', 'track', 'pop'];
const f2 = (v: number) => (+v).toFixed(2), fmtK = (v: number) => `${(+v).toFixed(2)}×`;
const opts = (list: string[], prefix: string): [string, string][] => list.map(v => [v, tx(prefix + v)]);

const Swatch = ({ st }: { st: Partial<Style> }) => <span className={s.swatch} aria-hidden="true">{[st.bg, st.bg2, st.text, st.accent].map((c, i) => <i key={i} style={{ background: c }} />)}</span>;
/** The presets, the saved custom themes, and the theme being edited (save, save as, delete). */
export function ThemePane({ s: ss, edit, ctx }: PaneProps) {
  const st = ss.style, custom = st.preset === 'custom', saved = useThemes(), [name, setName] = useState(st.name || '');
  useEffect(() => { setName(st.name || ''); }, [st.id, st.name]);
  const isSaved = custom && !!st.id && saved.some(t => t.id === st.id);
  const presets = ctx === 'song' ? ['cover', 'vinyl', 'liquid', 'gothic'] : Object.keys(PRESETS);
  // a look keeps the motion style and the knobs (a custom theme); a locked preset in the workshop is taken whole
  const usePreset = (k: string) => edit(x => { if (x.custom) x.applyLook(k); else x.applyPreset(k); });
  const resetCover = () => edit(x => { x.applyPreset('cover'); if (ctx === 'song') x.makeCustom(); });
  const save = (asNew: boolean) => { const n = name.trim() || tx('th.untitled'), id = saveTheme(st, n, asNew); edit(x => { x.style.id = id; x.style.name = n; x.style.edited = false; }); toast(tx('th.saved', { name: n })); };
  return (
    <Section title={tx('th.h')} note={!custom && ctx === 'workshop' ? tx('th.locked') : tx('th.help')}>
      <div className={s.presets}>
        {presets.map(k => <button key={k} type="button" className={s.preset} aria-pressed={(custom ? st.from === k && !st.id && !st.edited : st.preset === k)} onClick={() => usePreset(k)}><Swatch st={PRESETS[k]} /><span>{tx('preset.' + k)}</span></button>)}
        {saved.map(t => <button key={t.id} type="button" className={s.preset} aria-pressed={custom && st.id === t.id} onClick={() => edit(x => x.applyTheme({ ...(t.style as object), id: t.id, name: t.name }))}><Swatch st={t.style as Style} /><span>{t.name}</span></button>)}
        {custom && !isSaved && st.edited && <button type="button" className={s.preset} aria-pressed="true"><Swatch st={st} /><span>{tx('th.unsaved')}</span></button>}
      </div>
      {!custom && <Row><Button size="sm" onClick={() => edit(x => x.makeCustom())}>{tx('th.from')}</Button></Row>}
      {custom && <>
        <TextField label={tx('th.name')} value={name} placeholder={tx('th.untitled')} onCommit={setName} />
        <Row>
          <Button kind="primary" size="sm" onClick={() => save(false)}>{tx('th.save')}</Button>
          {isSaved && <Button size="sm" onClick={() => save(true)}>{tx('th.saveAs')}</Button>}
          {isSaved && <Button kind="ghost" size="sm" onClick={() => { const n = st.name || ''; deleteTheme(st.id!); edit(x => { x.style.id = null; x.style.name = ''; }); toast(tx('th.deleted', { name: n })); }}>{tx('th.del')}</Button>}
        </Row>
      </>}
      {ctx === 'song' && <Row><Button kind="ghost" size="sm" onClick={() => { resetCover(); toast(tx('s.resetCover')); }}>{tx('s.resetCover')}</Button></Row>}
    </Section>
  );
}
/** The backdrop, the frame and the colours. */
export function LookPane({ s: ss, edit, ctx, media }: PaneProps & { media?: React.ReactNode }) {
  const st = ss.style, custom = st.preset === 'custom', set = (k: string, v: unknown) => edit(x => x.setStyle(k, v));
  return (
    <>
      {(custom || media || st.bgStyle === 'cover' || ctx === 'workshop') && <Section title={tx('s.sec.bg')} note={ctx === 'song' && st.bgStyle === 'cover' ? tx('s.coverFromMeta') : undefined}>
        {custom && <Select label={tx('bg')} value={st.bgStyle} options={opts(BG_STYLES.filter(v => ctx === 'workshop' || v !== 'video'), 'bg.')} onChange={v => set('bgStyle', v)} />}
        {media}
        {st.bgStyle === 'solid' && <Slider label={tx('vd.dark')} min={0} max={0.9} step={0.05} value={st.solidDark ?? 0} format={f2} onChange={v => set('solidDark', v)} />}
        {st.bgStyle === 'cover' && <>
          <Select label={tx('cv.edge')} value={st.coverEdge || 'album'} options={opts(COVER_EDGE, 'cv.')} onChange={v => set('coverEdge', v)} />
          <Slider label={tx('cv.blur')} min={0} max={1} step={0.05} value={st.coverBlur ?? 0} format={f2} onChange={v => set('coverBlur', v)} />
          <Slider label={tx('cv.size')} min={0.3} max={0.9} step={0.05} value={st.coverSize ?? 0.6} format={f2} onChange={v => set('coverSize', v)} />
        </>}
        {ctx === 'workshop' && <Row>
          <Select label={tx('aspect')} value={st.aspect} options={ASPECTS.map(([v, k]) => [v, tx(k)])} onChange={v => set('aspect', v)} />
          <Select label={tx('aa')} value={st.aa || 'off'} options={opts(['off', 'ssaa', 'ssaa3'], 'aa.')} onChange={v => set('aa', v)} />
        </Row>}
        {ctx === 'workshop' && <Note>{tx('aa.help')}</Note>}
      </Section>}
      {custom && <Section title={tx('col.h')}>
        <Row><Button size="sm" onClick={() => edit(x => x.coverPalette())} disabled={!ss.cover}>{tx('cv.pal')}</Button></Row>
        <div className={s.colors}>{(['bg', 'bg2', 'text', 'accent', 'flash'] as const).map(k => (
          <ColorField key={k} label={tx('col.' + k)} value={st[k]} cover={ss.spec.coverUrl || null} onChange={v => set(k, v)} />))}</div>
      </Section>}
    </>
  );
}
export function TextPane({ s: ss, edit }: PaneProps) {
  const st = ss.style, custom = st.preset === 'custom', KN = Object.fromEntries(KNOBS.map(([k, , mn, mx, sp]) => [k, { mn, mx, sp }]));
  return (
    <Section title={tx('font')} note={custom ? tx('font.help') : undefined}>
      {custom && <div className={kit.field}><label>{tx('font')}</label><FontPicker label={tx('font')} value={st.font} text={ss.doc.lines.map(L => L.text).join('')} onChange={v => edit(x => x.setStyle('font', v))} /></div>}
      <Slider label={tx('k.size')} min={KN.size.mn} max={KN.size.mx} step={KN.size.sp} value={st.k.size} format={fmtK} home={1} onCommit={v => edit(x => x.setKnob('size', v))} />
      {custom && <Row><Button kind="ghost" size="sm" onClick={() => edit(x => { x.setStyle('font', presetStyle(x.style.from).font); x.setKnob('size', 1); })}>{tx('reset.font')}</Button></Row>}
    </Section>
  );
}
/** Each motion style drawn as the path its camera takes, small, on its card. */
const GLYPHS: Record<string, string> = {
  story: 'M2 14C10 14 14 4 22 4s12 10 20 10', waltz: 'M2 9c4-7 8-7 10 0s6 7 10 0 6-7 10 0 6 7 10 0', groove: 'M2 14h8l3-11 4 14 3-10h22',
  close: 'M15 2h14v14H15zM3 6h5v6H3zM36 6h5v6h-5z', float: 'M15 9a7 7 0 1 0 14 0a7 7 0 1 0-14 0M6 13h.01M38 4h.01', stage: 'M8 7h28M12 12h20',
};
function MotionGlyph({ id }: { id: string }) {
  return <svg width="44" height="18" viewBox="0 0 44 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={GLYPHS[id] || GLYPHS.story} /></svg>;
}
const GROUPS = [...new Set(KNOBS.map(k => k[1]))];
/** A knob's slider: its look follows the drag, what the plan reads of it is taken once it is let go. */
const knob = (edit: Edit, k: string) => ({ onChange: (v: number) => edit(x => x.setKnob(k, v, true)), onCommit: KNOB_REBUILD[k] ? (v: number) => edit(x => x.setKnob(k, v)) : undefined });
/** The motion style (風格) with the one that fits this song marked, five knobs to tune it, and everything in detail
 *  under 進階 (the camera, lyric type, entrance, exit and the detailed knobs the five multiply). */
export function MotionPane({ s: ss, edit }: PaneProps) {
  const st = ss.style, custom = st.preset === 'custom', set = (k: string, v: unknown) => edit(x => x.setStyle(k, v)), [adv, setAdv] = useState(false);
  const cur = motionOf(st), rec = ss.recommended, name = (id: string) => tx('mo.' + id), mine = useMotions();
  const own = st.motionId ? mine.find(m => m.id === st.motionId) : undefined, [mName, setMName] = useState(st.motionName || '');
  useEffect(() => { setMName(st.motionName || ''); }, [st.motionId, st.motionName]);
  const pick = (v: string) => { const m = v.startsWith('u:') ? mine.find(e => 'u:' + e.id === v) : undefined; edit(x => (m ? x.applySavedMotion(m.motion, m.id, m.name) : x.applyMotion(v))); };
  const saveMine = (asNew: boolean) => { const n = mName.trim() || tx('mo.untitled'), id = saveMotion(st, n, asNew); edit(x => { x.style.motionId = id; x.style.motionName = n; }); toast(tx('mo.saved', { name: n })); };
  const delMine = () => { if (!own) return; deleteMotion(own.id); edit(x => { x.style.motionId = null; x.style.motionName = ''; }); toast(tx('mo.deleted', { name: own.name })); };
  const resetGroup = (g: string) => edit(x => { for (const [k, gg] of KNOBS) if (gg === g && k !== 'size') x.setKnob(k, 1); });
  const resetTune = () => edit(x => { for (const [k] of MACROS) x.setKnob(k, 1); });
  // (all back to the motion style as it comes: its own settings, every knob at 1)
  const resetAll = () => edit(x => { x.applyMotion(motionOf(x.style)); for (const [k] of [...KNOBS, ...MACROS]) if (k !== 'size') x.setKnob(k, 1); x.setStyle('trans', 'auto'); x.setStyle('future', 'dim'); });
  return (
    <>
      {!custom && <Note>{tx('th.locked')}</Note>}
      <fieldset disabled={!custom} className={s.set}>
        <Section title={tx('mo.builtin')} note={tx('mo.help')}>
          <div className={s.motions} role="radiogroup" aria-label={tx('mo.style')}>
            {Object.keys(MOTIONS).map(id => (
              <button key={id} type="button" role="radio" className={s.motion} aria-checked={!own && cur === id} onClick={() => pick(id)}>
                <MotionGlyph id={id} />
                <span>{name(id)}{id === rec && <em>{tx('mo.rec')}</em>}</span>
              </button>))}
          </div>
          <Note>{own ? tx('mo.mineFit', { name: name(own.motion.base) }) : tx('mo.' + cur + '.fit')}{!own && cur !== rec ? ' ' + tx('mo.recNote', { name: name(rec) }) : ''}</Note>
        </Section>
        <Section title={tx('mo.mine')} note={tx('mo.mineHelp')}>
          {!!mine.length && <div className={s.motions} role="radiogroup" aria-label={tx('mo.mine')}>
            {mine.map(m => (
              <button key={m.id} type="button" role="radio" className={s.motion + ' ' + s.mine} aria-checked={own?.id === m.id} onClick={() => pick('u:' + m.id)}>
                <span>{m.name}</span><small>{tx('mo.basedOn', { name: name(m.motion.base) })}</small>
              </button>))}
          </div>}
          <TextField label={tx('mo.name')} value={mName} placeholder={tx('mo.untitled')} onCommit={setMName} />
          <Row>
            <Button kind="primary" size="sm" onClick={() => saveMine(!own)}>{tx(own ? 'mo.save' : 'mo.saveNew')}</Button>
            {own && <Button size="sm" onClick={() => saveMine(true)}>{tx('mo.saveAs')}</Button>}
            {own && <Button kind="ghost" size="sm" onClick={delMine}>{tx('mo.del')}</Button>}
          </Row>
        </Section>
        <Section title={tx('mo.tune')} note={tx('help.knobs')} action={<Button kind="ghost" size="sm" onClick={resetTune}>{tx('reset.group')}</Button>}>
          {MACROS.map(([k, mn, mx, sp]) => <Slider key={k} label={tx('km.' + k)} min={mn} max={mx} step={sp} value={st.k[k] ?? 1} format={fmtK} home={1} {...knob(edit, k)} />)}
        </Section>
        <Section title={tx('adv.h')} note={adv ? tx('adv.help') : undefined} action={<Button kind="ghost" size="sm" aria-expanded={adv} onClick={() => setAdv(v => !v)}>{tx(adv ? 'adv.hide' : 'adv.show')}</Button>}>
          {adv && <>
            <Select label={tx('cut')} value={st.cut} options={opts(CUTS, 'cut.')} onChange={v => set('cut', v)} />
            <Row>
              <Select label={tx('trans')} value={st.trans || 'auto'} options={opts(['auto', 'off'], 'trans.')} onChange={v => set('trans', v)} />
              <Select label={tx('flash')} value={st.flashMode} options={opts(['color', 'invert'], 'flash.')} onChange={v => set('flashMode', v)} />
            </Row>
            <Select label={tx('ltype')} value={st.ltype || 'flow'} options={opts(Object.keys(LYRIC_TYPES), 'lt.')} onChange={v => set('ltype', v)} />
            <Select label={tx('future')} value={st.future} options={opts(['dim', 'hide'], 'future.')} onChange={v => set('future', v)} />
            <Row>
              <Select label={tx('tin')} value={st.tin || 'mix'} options={opts(TIN, 'tin.')} onChange={v => set('tin', v)} />
              <Select label={tx('tout')} value={st.tout === 'drift' || st.tout === 'spread' ? st.tout : 'none'} options={opts(['none', 'drift', 'spread'], 'tout.')} onChange={v => set('tout', v)} />
            </Row>
            {GROUPS.map(g => (
              <Section key={g} title={tx(g)} action={<Button kind="ghost" size="sm" onClick={() => resetGroup(g)}>{tx('reset.group')}</Button>} note={g === 'grp.triggers' ? tx('help.triggers') : undefined}>
                {KNOBS.filter(([k, gg]) => gg === g && k !== 'size').map(([k, , mn, mx, sp]) => <Slider key={k} label={tx('k.' + k)} min={mn} max={mx} step={sp} value={st.k[k]} format={fmtK} home={1} {...knob(edit, k)} />)}
              </Section>
            ))}
            <Row><Button size="sm" onClick={resetAll}>{tx('reset.all')}</Button></Row>
          </>}
        </Section>
      </fieldset>
    </>
  );
}
// effects drawn as companions of a backdrop or of another effect (they follow it, not a switch of their own)
const COMPANIONS = new Set(['gothic-chains', 'geo-front', 'glass-shards', 'feathers-fg', 'mv']);
/** The effects in groups: the air of the picture, the screen's own texture, the lyrics' own, and the ones made for a
 *  backdrop (they work on any; their group says which they were made for). Anything new lands in the last. */
const FX_GROUPS: [string, string[]][] = [
  ['fxg.ambience', ['motes', 'feathers', 'stars', 'rings', 'eq', 'grid']],
  ['fxg.screen', ['grain', 'vignette', 'scan', 'chroma', 'glitch', 'invgeo']],
  ['fxg.lyrics', ['frame', 'wordring', 'glyph', 'afterimage']],
  ['fxg.gothic', ['glass']],
  ['fxg.vinyl', ['doors', 'lines', 'wires', 'shards']],
];
export function EffectsPane({ s: ss, edit }: PaneProps) {
  const st = ss.style, custom = st.preset === 'custom', list = effects('effect').filter(e => !COMPANIONS.has(e.id)), known = new Set(FX_GROUPS.flatMap(g => g[1]));
  const groups: [string, typeof list][] = [...FX_GROUPS.map(([g, ids]) => [g, ids.map(id => list.find(e => e.id === id)).filter(Boolean)] as [string, typeof list]),
    ['fxg.other', list.filter(e => !known.has(e.id))]];
  return (
    <>
      {!custom && <Note>{tx('th.locked')}</Note>}
      <fieldset disabled={!custom} className={s.set}>
        {groups.filter(([, es]) => es.length).map(([g, es]) => (
          <Section key={g} title={tx(g)}>
            <div className={s.fxList}>
              {es.map(e => (
                <div key={e.id} className={s.fx} data-on={!!st.fx[e.id]}>
                  <Check label={tx(e.label)} checked={!!st.fx[e.id]} onChange={v => edit(x => x.setEffect(e.id, v))} />
                  {st.fx[e.id] && (e.params || []).map(p => <ParamControl key={p.key} p={p} value={st.fxp?.[e.id]?.[p.key] ?? p.def}
                    onChange={v => edit(x => x.setEffectParam(e.id, p.key, v, true))} onCommit={v => edit(x => x.setEffectParam(e.id, p.key, v))} />)}
                </div>
              ))}
            </div>
          </Section>
        ))}
      </fieldset>
    </>
  );
}
function ParamControl({ p, value, onChange, onCommit }: { p: Param; value: number | string | boolean; onChange: (v: number | string | boolean) => void; onCommit: (v: number | string | boolean) => void }) {
  if (p.kind === 'toggle') return <Check label={tx(p.label)} checked={!!value} onChange={onCommit} />;
  if (p.kind === 'select') return <Select label={tx(p.label)} value={String(value)} options={(p.options || []).map(([v, k]) => [v, tx(k)])} onChange={onCommit} />;
  return <Slider label={tx(p.label)} min={p.min ?? 0} max={p.max ?? 1} step={p.step ?? 0.05} value={+value} format={f2} onChange={onChange} onCommit={onCommit} />;
}
const SONG_FIELDS = ['title', 'composer', 'lyricist', 'artist'] as const;
export function EndPane({ s: ss, edit }: PaneProps) {
  const G = ss.spec.song;
  return (
    <Section note={tx('end.help')}>
      <Check label={tx('end.on')} checked={G.on} onChange={v => edit(x => x.setSong({ on: v }))} />
      {SONG_FIELDS.map(k => <TextField key={k} label={tx('end.' + k)} value={(G as any)[k] || ''} onCommit={v => edit(x => x.setSong({ [k]: v }))} />)}
      <Slider label={tx('end.len')} min={2} max={8} step={0.5} value={ss.endLen} format={v => (+v).toFixed(1) + ' s'} onCommit={v => edit(x => x.setTiming({ endLen: v }))} />
    </Section>
  );
}

/* ---------- export ---------- */
const EXPORT = {
  res: [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '2160p']] as [string, string][],
  fps: [['30', '30 fps'], ['60', '60 fps']] as [string, string][],
  quality: ['q1', 'q2', 'q3', 'q4', 'q5'], codec: ['auto', 'hevc', 'avc'],
};
/** an export is running (dialogs around it stay open) */
export let exportBusy = false;
const defaults = { res: '1080', fps: '30', quality: 'q1', codec: 'auto', captions: true, audio: true };
/** aspect: the frame shape, chosen here too (a library song's: the app's own setting; the workshop sets it in its look) */
export function ExportPanel({ engine, s: ss, before, aspect }: { engine: Engine; s: Session; before?: () => void | Promise<void>; aspect?: { value: string; options: string[]; set: (v: string) => void } }) {
  const [o, setO] = useState(() => ({ ...defaults, ...remember('export', {}) }));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [saved, setSaved] = useState<{ path?: string; blob?: Blob; name?: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null), live = useRef<HTMLSpanElement>(null), sig = useRef({ cancelled: false });
  const set = (k: string, v: unknown) => setO(p => { const n = { ...p, [k]: v }; keep('export', n); return n; });
  const est = estimate(ss, { res: +o.res, fps: +o.fps, quality: o.quality }, engine.viewAspect());
  const start = async () => {
    if (busy) { sig.current.cancelled = true; return; }
    setMsg(''); setSaved(null); await before?.();
    const name = `${(ss.spec.song.title || 'cadenza').trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) || 'cadenza'}-${est.w}x${est.h}.mp4`;
    let path: string | null = null; if (desktop) { path = await pickSavePath(name, 'mp4'); if (!path) return; }
    sig.current = { cancelled: false }; setBusy(true); exportBusy = true; pauseAnalysis(true);
    try {
      const r = await exportVideo(engine, ss, { res: +o.res, fps: +o.fps, quality: o.quality, codec: o.codec as 'auto', captions: o.captions, audio: o.audio, signal: sig.current,
        sink: path ? fileSink(path) : blobSink(),
        onProgress: (phase, i, n) => { bar.current?.style.setProperty('--k', String(n ? i / n : 0)); if (live.current) live.current.textContent = phase === 'render' ? tx('x.render', { i: Math.max(1, i), n }) : phase === 'audio' ? tx('x.audio') : phase === 'video' ? tx('x.vprep') : ''; } });
      if (live.current) live.current.textContent = '';
      if (!r.ok) { setMsg(tx(r.reason || 'x.fail', { e: r.e || '' })); return; }
      const done = tx('x.done', { w: r.w!, h: r.h!, aud: tx(r.audio!), mb: ((r.size || 0) / 1048576).toFixed(1), sec: (r.sec || 0).toFixed(1) }) + ` ${r.codec}, ${r.mbps} Mbps.`;
      if (path) { setSaved({ path }); setMsg(done + ' ' + tx('x.savedTo', { path })); }
      else { const blob = (r.result as { blob: Blob }).blob; setSaved({ blob, name: r.name }); setMsg(done); await offerFile(r.name!, blob); }
    } finally { setBusy(false); exportBusy = false; pauseAnalysis(false); bar.current?.style.setProperty('--k', '0'); }
  };
  return (
    <div className={s.export}>
      <Note>{tx('x.info', { w: est.w, h: est.h, dur: est.dur.toFixed(1), aud: tx(est.audio ? 'x.info.aud' : 'x.info.noaud') })} {tx('x.size', { mbps: est.mbps.toFixed(0), mb: est.mb })}</Note>
      <fieldset disabled={busy} className={s.set}>
        {aspect && <Select label={tx('aspect')} value={aspect.value} options={aspect.options.map(a => [a, a])} onChange={aspect.set} />}
        <Row><Select label={tx('x.res')} value={o.res} options={EXPORT.res} onChange={v => set('res', v)} /><Select label={tx('x.fps')} value={o.fps} options={EXPORT.fps} onChange={v => set('fps', v)} /></Row>
        <Row><Select label={tx('x.q')} value={o.quality} options={EXPORT.quality.map((v, i) => [v, tx('x.q.' + (i + 1))])} onChange={v => set('quality', v)} />
          <Select label={tx('x.codec')} value={o.codec} options={[['auto', tx('x.codec.auto')], ['hevc', 'H.265 / HEVC'], ['avc', 'H.264 / AVC']]} onChange={v => set('codec', v)} /></Row>
        <Check label={tx('x.cap')} checked={o.captions} onChange={v => set('captions', v)} />
        {ss.audio && <Check label={tx('x.aud')} checked={o.audio} onChange={v => set('audio', v)} />}
      </fieldset>
      <Note>{tx('x.cap.note')}</Note>
      <div className={s.xbar} ref={bar} aria-hidden="true"><i /></div>
      <p className={s.status} role="status" aria-live="polite"><span ref={live} />{msg}</p>
      <Row>
        <Button kind="primary" onClick={start}>{tx(busy ? 'x.cancel' : 'x.go')}</Button>
        {saved?.blob && <Button onClick={() => offerFile(saved.name!, saved.blob!)}>{tx('x.save')}</Button>}
        {saved?.path && <Button onClick={() => D?.showItem(saved.path!)}>{tx('x.show')}</Button>}
      </Row>
    </div>
  );
}
