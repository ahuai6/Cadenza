import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addTranslations,
  appendTtmlLine,
  applyTimedTtmlText,
  emptyTtml,
  keepTtmlLanguage,
  mergeAuxiliaryLyrics,
  openTtml,
  readableTtml,
  removeTtmlLanguage,
  replaceTtmlTrack,
  timedTtmlText,
  translationPlan,
  updateTtml,
  isTtml,
} from '../../engine';
import { tx } from '../../i18n';
import { Lib, LyricAI, type LyricField, type LyricSources, type LyricTarget } from '../bridge';
import { canEdit, stageLyricDraft, useEditing, useEditingDraft } from '../editing';
import { commitLyricField, previewLyrics, resetLyricPreview, switchLyricSource } from '../playback/lyric-edit';
import { lib, trackOf, useStore } from '../state';
import { AiLyricTranslation } from './AiLyricTranslation';
import { LyricTextEditor } from './LyricTextEditor';
import { Button, Note, Row } from './kit';
import s from './LyricSources.module.css';

export function LyricSourcesEditor({ id }: { id: string }) {
  const [data, setData] = useState<LyricSources | null>();
  const [selected, choose] = useState('');
  const [message, notice] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = useEditing();
  const library = useStore(lib, (value) => value.tracks.find((track) => track.id === id)?.lyricsRevision);
  const request = useRef(0);
  async function reload() {
    const run = ++request.current;
    const next = await Lib?.lyricSources(id).catch(() => null);
    if (run === request.current) setData(next ?? null);
    return next;
  }
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [id, library]);
  if (data === undefined) return <Note>{tx('s.searching')}</Note>;
  if (!data) return <Note>无法读取歌词来源。请确认文件可访问，再重新扫描。</Note>;
  const options = [...data.fields, ...data.targets];
  const target =
    options.find((field) => field.id === selected) ?? options.find((field) => field.id === data.primary) ?? options[0];
  const field = data.fields.find((field) => field.id === target?.id);
  return (
    <div className={s.editor}>
      <Row>
        <label>
          歌词来源{' '}
          <select
            aria-label="歌词来源"
            value={target?.id || ''}
            disabled={busy}
            onChange={(e) => {
              choose(e.target.value);
              notice('');
            }}
          >
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ·{' '}
                {'revision' in item
                  ? item.format.toUpperCase() + (item.id === data.primary ? ' · 播放中' : '')
                  : '新建'}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={busy || !field || field.id === data.primary}
          onClick={async () => {
            if (!field) return;
            setBusy(true);
            try {
              if (!(await switchLyricSource(id, field.id))) notice('未能切换播放歌词。');
              await reload();
            } catch {
              notice('未能切换播放歌词。');
            } finally {
              setBusy(false);
            }
          }}
        >
          用于播放
        </Button>
      </Row>
      {data.errors.length > 0 && <Note>部分来源读取失败（{data.errors.join('、')}）。请保留原始文件。</Note>}
      {message && <Note>{message}</Note>}
      {field && <LyricSourcePreview key={id + ':' + field.revision} id={id} field={field} fields={data.fields} />}
      {!editing && <LyricLookup id={id} />}
      {target && editing && (
        <LyricDraft
          key={id + ':' + target.id + ':' + (field?.revision ?? 'new')}
          id={id}
          target={target}
          field={field}
          fields={data.fields}
          busy={busy}
          setBusy={setBusy}
          translationTargets={options
            .filter(
              (item) =>
                item.id === 'sidecar:translation' ||
                item.id === 'new:translation' ||
                (item.id.startsWith('flac:') && item.label.toUpperCase() === 'LYRICS_TRANSLATION'),
            )
            .filter((item) => !('writable' in item) || item.writable === true)}
          stageTranslation={
            field && !/translation/i.test(field.id)
              ? (value, destination, replace) => {
                  const existing = data.fields.find((item) => item.id === destination);
                  const revised = existing ? mergeAuxiliaryLyrics(existing.text, value, replace) : value;
                  if (
                    revised === null ||
                    !stageLyricDraft(
                      'lyric-source:' + id + ':' + destination + ':' + (existing?.revision ?? 'new'),
                      revised,
                    )
                  )
                    return false;
                  choose(destination);
                  notice(tx('lyricAi.applied'));
                  return true;
                }
              : undefined
          }
          saved={async () => {
            await reload();
            notice('已保存到所选来源。');
          }}
        />
      )}
    </div>
  );
}

function LyricSourcePreview({ id, field, fields }: { id: string; field: LyricField; fields: LyricField[] }) {
  const [auxiliary, setAuxiliary] = useState('');
  const [role, setRole] = useState<'translation' | 'transliteration'>('translation');
  const [track, setTrack] = useState('');
  const [message, notice] = useState('');
  const ttml = field.format === 'ttml';
  const rows = useMemo(() => (ttml ? readableTtml(field.text) : null), [ttml, field.text]);
  const tracks = Array.from(
    new Set(
      rows
        ?.filter((row) => row.kind === 'translation' || row.kind === 'transliteration')
        .map((row) => row.kind + ':' + row.lang),
    ),
  );
  async function preview() {
    let text = field.text;
    if (auxiliary) {
      const source = fields.find((item) => item.id === auxiliary);
      if (!source) return;
      const plan = translationPlan(text, source.text);
      const result = addTranslations(text, 'und-x-preview', plan.rows, role);
      if (!result?.added) {
        notice('没有可靠匹配的附属歌词。');
        return;
      }
      text = result.text;
      if (result.added < plan.rows.length) notice(`临时加入 ${result.added} 行，低置信度匹配已跳过。`);
    } else if (track) {
      const [kind, lang] = track.split(':');
      text = keepTtmlLanguage(text, kind, lang);
    }
    if ((await previewLyrics(id, text)) && !auxiliary) notice('正在临时预览。');
  }
  return (
    <details>
      <summary>查看来源与临时预览</summary>
      <pre className={s.preview}>
        {rows
          ? rows
              .map((row) =>
                [
                  row.begin && '[' + row.begin + ']',
                  row.kind !== 'main' && '(' + row.kind + ' ' + row.lang + ')',
                  row.slots.map((slot) => slot.value).join(''),
                ]
                  .filter(Boolean)
                  .join(' '),
              )
              .join('\n')
          : field.text}
      </pre>
      <Row>
        {ttml && tracks.length > 0 && (
          <label>
            语言轨{' '}
            <select value={track} onChange={(e) => setTrack(e.target.value)}>
              <option value="">全部</option>
              {tracks.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        )}
        {ttml && fields.some((item) => item.format === 'lrc') && (
          <>
            <label>
              附属来源{' '}
              <select value={auxiliary} onChange={(e) => setAuxiliary(e.target.value)}>
                <option value="">不组合</option>
                {fields
                  .filter((item) => item.format === 'lrc')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
            {auxiliary && (
              <select aria-label="附属轨类型" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="translation">译文</option>
                <option value="transliteration">音译</option>
              </select>
            )}
          </>
        )}
        <Button size="sm" onClick={() => void preview().catch(() => notice('预览失败。'))}>
          临时预览
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void resetLyricPreview(id)
              .then(() => notice('已恢复播放来源。'))
              .catch(() => notice('恢复失败。'))
          }
        >
          结束预览
        </Button>
      </Row>
      {message && <Note>{message}</Note>}
    </details>
  );
}
function LyricLookup({
  id,
  useDraft,
  matchTrack,
}: {
  id: string;
  useDraft?: (value: string) => void;
  matchTrack?: (original: string, auxiliary: string, kind: 'translation' | 'transliteration') => void;
}) {
  const track = trackOf(id);
  const [title, setTitle] = useState(track?.title ?? '');
  const [artist, setArtist] = useState(track?.artist ?? '');
  const [result, setResult] = useState<Awaited<ReturnType<NonNullable<typeof Lib>['searchLyrics']>>>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
      void Lib?.cancelLyricSearch();
    },
    [],
  );
  return (
    <details>
      <summary>搜索歌词</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !title.trim()) return;
          const run = ++request.current;
          setBusy(true);
          setResult([]);
          setNote('');
          try {
            const items = await Lib!.searchLyrics({
              title,
              artist,
              album: track?.album,
              duration: track?.duration,
              isrc: track?.isrc?.[0],
            });
            if (run === request.current) {
              setResult(items);
              setNote(items.length ? '' : '未找到歌词。');
            }
          } catch {
            if (run === request.current) setNote('歌词查询失败。');
          } finally {
            if (run === request.current) setBusy(false);
          }
        }}
      >
        <Row>
          <label>
            标题 <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            歌手 <input value={artist} onChange={(event) => setArtist(event.target.value)} />
          </label>
          <Button size="sm" disabled={busy || !title.trim()} type="submit">
            {busy ? '查询中' : '查询'}
          </Button>
          {busy && (
            <Button
              size="sm"
              onClick={() => {
                request.current++;
                void Lib!.cancelLyricSearch();
                setBusy(false);
              }}
            >
              {tx('lyricAi.cancel')}
            </Button>
          )}
        </Row>
      </form>
      {result.map((item) => {
        const text = item.synced || item.plain;
        return (
          text && (
            <details key={item.id}>
              <summary>
                {item.title} / {item.artist} / {item.source} / {item.format.toUpperCase()} /{' '}
                {tx('lyricLookup.' + item.precision)}
              </summary>
              <Note>
                {[
                  item.album,
                  item.duration > 0 ? Math.round(item.duration) + ' s' : '',
                  ...item.warnings.map((warning) => tx('lyricLookup.' + warning)),
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </Note>
              <pre className={s.preview}>{text}</pre>
              {(
                [
                  ['translation', item.translation],
                  ['transliteration', item.transliteration],
                ] as const
              ).map(
                ([kind, value]) =>
                  value && (
                    <details key={kind}>
                      <summary>{tx('lyricLookup.' + kind)}</summary>
                      <pre className={s.preview}>{value}</pre>
                      {matchTrack && (
                        <Button
                          size="sm"
                          onClick={() => {
                            if (canEdit()) matchTrack(text, value, kind);
                          }}
                        >
                          {tx('lyricLookup.matchTrack')}
                        </Button>
                      )}
                    </details>
                  ),
              )}
              <Row>
                <Button
                  size="sm"
                  onClick={() =>
                    void previewLyrics(id, text)
                      .then((ok) => {
                        setNote(ok ? '正在临时预览搜索结果。' : '曲目已切换。');
                      })
                      .catch(() => setNote('预览失败。'))
                  }
                >
                  临时预览
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    void resetLyricPreview(id)
                      .then(() => setNote('已恢复播放来源。'))
                      .catch(() => setNote('恢复失败。'))
                  }
                >
                  结束预览
                </Button>
                {useDraft && (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (canEdit()) useDraft(text);
                    }}
                  >
                    使用为草稿
                  </Button>
                )}
              </Row>
            </details>
          )
        );
      })}
      {note && <Note>{note}</Note>}
    </details>
  );
}

function LyricDraft({
  id,
  target,
  field,
  fields,
  busy,
  setBusy,
  saved,
  stageTranslation,
  translationTargets,
}: {
  id: string;
  target: LyricTarget;
  field?: LyricField;
  fields: LyricField[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  saved: () => Promise<void>;
  stageTranslation?: (value: string, destination: string, replace: boolean) => boolean;
  translationTargets: LyricTarget[];
}) {
  const original = field?.text ?? (target.format === 'ttml' ? emptyTtml : '');
  const [text, setText, clear] = useEditingDraft(
    'lyric-source:' + id + ':' + target.id + ':' + (field?.revision ?? 'new'),
    () => original,
  );
  const [raw, setRaw] = useState(false);
  const [timed, setTimed] = useState(false);
  const [timedText, setTimedText, clearTimed, syncTimed] = useEditingDraft(
    'lyric-source:timed:' + id + ':' + target.id + ':' + (field?.revision ?? 'new'),
    () => timedTtmlText(original),
  );
  const [lane, setLane] = useState('main:');
  const [role, setRole] = useState<'translation' | 'transliteration'>('translation');
  const [lineStart, setLineStart] = useState('0s');
  const [findLine, setFindLine] = useState('');
  const [replaceLine, setReplaceLine] = useState('');
  const [removeLane, setRemoveLane] = useState(false);
  const [newLaneRole, setNewLaneRole] = useState<'translation' | 'transliteration'>('translation');
  const [newLaneLanguage, setNewLaneLanguage] = useState('zh-Hans');
  const [newLaneRow, setNewLaneRow] = useState(0);
  const [newLaneText, setNewLaneText] = useState('');
  const [undo, setUndo] = useState<string[]>([]);
  const [redo, setRedo] = useState<string[]>([]);
  const [message, notice] = useState('');
  const [reference, setReference] = useState('');
  const [remoteReference, setRemoteReference] = useState<{ original: string; auxiliary: string } | null>(null);
  const matchDetails = useRef<HTMLDetailsElement>(null);
  const [language, setLanguage] = useState('zh-Hans');
  const [plan, setPlan] = useState<ReturnType<typeof translationPlan> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [extraRows, setExtraRows] = useState<Record<number, number>>({});
  const ttml = isTtml(text);
  const rows = useMemo(() => (ttml && !raw ? readableTtml(text) : null), [ttml, raw, text]);
  const lanes = Array.from(new Set(rows?.map((row) => row.kind + ':' + row.lang)));
  const writable = field?.writable ?? true;
  const editorRun = useRef(0);
  useEffect(
    () => () => {
      editorRun.current++;
      setBusy(false);
    },
    [setBusy],
  );
  function update(value: string) {
    if (value === text) return;
    if (rows) {
      setUndo([...undo.slice(-19), text]);
      setRedo([]);
    }
    setText(value);
    setPlan(null);
    setExtraRows({});
    notice('');
  }
  async function mutate(next: string | null) {
    if (busy || !canEdit() || !writable) return;
    if (next !== null && (ttml || target.format === 'ttml') && !openTtml(next)) {
      notice('TTML 未通过 XML 校验。');
      return;
    }
    setBusy(true);
    try {
      const result = await commitLyricField(id, { source: target.id, revision: field?.revision, text: next });
      if (!result.ok) {
        notice('写入失败，草稿已保留（' + result.why + '）。');
        return;
      }
      clear(next ?? '');
      clearTimed(timedTtmlText(next ?? ''));
      await saved();
    } catch {
      notice('写入失败，草稿已保留。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className={s.draft} disabled={busy}>
      <legend>
        {target.label}
        {writable ? '' : ' · 只读'}
      </legend>
      <Row>
        {ttml && (
          <>
            <Button
              size="sm"
              onClick={() => {
                setRaw(!raw);
                setTimed(false);
              }}
            >
              {raw ? '按行编辑' : '高级 XML'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setTimed(!timed);
                setRaw(false);
                syncTimed(timedTtmlText(text));
              }}
            >
              {timed ? '按行编辑' : '时间戳文本'}
            </Button>
          </>
        )}
        {!field && target.format === 'either' && (
          <Button size="sm" onClick={() => update(ttml ? '' : emptyTtml)}>
            {ttml ? '新建 LRC' : '新建 TTML'}
          </Button>
        )}
        <Button
          size="sm"
          onClick={async () => {
            const run = editorRun.current;
            try {
              const imported = await Lib!.importLyricsFile();
              if (imported !== null && run === editorRun.current && canEdit()) update(imported);
            } catch {
              if (run === editorRun.current) notice('导入失败。');
            }
          }}
        >
          导入到草稿
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            if ((ttml || target.format === 'ttml') && !openTtml(text)) {
              notice('TTML 未通过 XML 校验。');
              return;
            }
            try {
              if (await Lib!.exportLyrics(id, text)) notice('已独立导出。');
            } catch {
              notice('导出失败。');
            }
          }}
        >
          独立导出
        </Button>
      </Row>
      <LyricLookup
        id={id}
        useDraft={update}
        matchTrack={
          ttml && writable
            ? (original, auxiliary, kind) => {
                setRemoteReference({ original, auxiliary });
                setReference('@online');
                setRole(kind);
                setPlan(translationPlan(text, original, auxiliary));
                requestAnimationFrame(() => {
                  if (!matchDetails.current) return;
                  matchDetails.current.open = true;
                  matchDetails.current.querySelector('summary')?.focus();
                });
              }
            : undefined
        }
      />
      {(ttml || (stageTranslation && translationTargets.length)) && writable && LyricAI && (
        <AiLyricTranslation
          text={text}
          context={[trackOf(id)?.title, trackOf(id)?.artist, trackOf(id)?.album].filter(Boolean).join(' / ')}
          apply={update}
          stageAuxiliary={stageTranslation}
          auxiliaryTargets={translationTargets}
        />
      )}
      {timed && ttml ? (
        <div className={s.editor}>
          <Note>每行对应原文的一段。选中有多个逐字锚点的文本时，请返回按行视图分别修改。</Note>
          <LyricTextEditor label="TTML 时间戳文本" value={timedText} update={setTimedText} xml />
          <Row>
            <Button
              size="sm"
              onClick={() => {
                const next = applyTimedTtmlText(text, timedText);
                if (next === null) {
                  notice('无法保持原有逐字锚点。请核对行数和时间，或在按行视图修改。');
                  return;
                }
                update(next);
                clearTimed(timedTtmlText(next));
                setTimed(false);
                notice('已应用时间戳文本到草稿。');
              }}
            >
              应用到原文草稿
            </Button>
            <Button size="sm" onClick={() => clearTimed(timedTtmlText(text))}>
              恢复时间戳文本
            </Button>
          </Row>
        </div>
      ) : rows ? (
        <>
          <Row>
            <label>
              编辑轨道{' '}
              <select
                value={lane}
                onChange={(e) => {
                  setLane(e.target.value);
                  setRemoveLane(false);
                }}
              >
                {lanes.map((name) => (
                  <option key={name} value={name}>
                    {name === 'main:' ? '原词' : name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={!undo.length}
              onClick={() => {
                setRedo([...redo, text]);
                setText(undo[undo.length - 1]);
                setUndo(undo.slice(0, -1));
                setPlan(null);
              }}
            >
              撤销
            </Button>
            <Button
              size="sm"
              disabled={!redo.length}
              onClick={() => {
                setUndo([...undo, text]);
                setText(redo[redo.length - 1]);
                setRedo(redo.slice(0, -1));
                setPlan(null);
              }}
            >
              重做
            </Button>
          </Row>
          <details>
            <summary>在当前语言轨查找与替换</summary>
            <Row>
              <label>
                查找 <input value={findLine} onChange={(e) => setFindLine(e.target.value)} />
              </label>
              <label>
                替换为 <input value={replaceLine} onChange={(e) => setReplaceLine(e.target.value)} />
              </label>
              <Button
                size="sm"
                disabled={!findLine}
                onClick={() => {
                  const [kind, locale] = lane.split(':');
                  const updated = replaceTtmlTrack(text, kind, locale, findLine, replaceLine);
                  update(updated);
                  notice(updated === text ? '没有匹配项。' : '已替换该轨中的匹配文本，可撤销。');
                }}
              >
                替换本轨
              </Button>
            </Row>
          </details>
          <details>
            <summary>新增译文或音译</summary>
            <Row>
              <select
                aria-label="新语言轨类型"
                value={newLaneRole}
                onChange={(e) => setNewLaneRole(e.target.value as typeof newLaneRole)}
              >
                <option value="translation">译文</option>
                <option value="transliteration">音译</option>
              </select>
              <label>
                语言 <input value={newLaneLanguage} onChange={(e) => setNewLaneLanguage(e.target.value)} size={8} />
              </label>
              <label>
                原文行{' '}
                <select value={newLaneRow} onChange={(e) => setNewLaneRow(Number(e.target.value))}>
                  {rows
                    .filter((row) => row.kind === 'main')
                    .map((row, index) => (
                      <option key={index} value={index}>
                        {row.begin ?? '—'} · {row.slots.map((part) => part.value).join('')}
                      </option>
                    ))}
                </select>
              </label>
            </Row>
            <label className={s.editor}>
              附属歌词 <input value={newLaneText} onChange={(e) => setNewLaneText(e.target.value)} />
            </label>
            <Button
              size="sm"
              disabled={!newLaneText}
              onClick={() => {
                const result = addTranslations(
                  text,
                  newLaneLanguage,
                  [{ row: newLaneRow, translation: newLaneText }],
                  newLaneRole,
                );
                if (!result) {
                  notice('请检查语言代码和目标行。');
                  return;
                }
                if (!result.added) {
                  notice('该行已存在同语言内容。请选中对应轨道编辑。');
                  return;
                }
                update(result.text);
                setLane(newLaneRole + ':' + newLaneLanguage);
                setNewLaneText('');
              }}
            >
              添加到草稿
            </Button>
          </details>
          {lane === 'main:' ? (
            <Row>
              <label>
                新行时间 <input value={lineStart} size={7} onChange={(e) => setLineStart(e.target.value)} />
              </label>
              <Button
                size="sm"
                onClick={() => {
                  const updated = appendTtmlLine(text, lineStart);
                  if (updated === text) notice('无法添加，请检查时间格式。');
                  else update(updated);
                }}
              >
                添加歌词行
              </Button>
            </Row>
          ) : (
            /^(translation|transliteration):/.test(lane) && (
              <Row>
                <Button size="sm" onClick={() => setRemoveLane(!removeLane)}>
                  删除当前语言轨
                </Button>
                {removeLane && (
                  <Button
                    size="sm"
                    onClick={() => {
                      const [k, locale] = lane.split(':');
                      update(removeTtmlLanguage(text, k, locale));
                      setLane('main:');
                      setRemoveLane(false);
                      notice('已在草稿中删除该语言轨。');
                    }}
                  >
                    确认从草稿删除
                  </Button>
                )}
              </Row>
            )
          )}
          <div className={s.lines} data-lyric-editor-lines="" aria-label="TTML 歌词行">
            {rows.map(
              (row, i) =>
                row.kind + ':' + row.lang === lane && (
                  <div key={i} className={s.line}>
                    <small>{row.label || i + 1}</small>
                    {row.kind === 'main' &&
                      (['begin', 'end'] as const).map((time) => (
                        <TtmlTimeInput
                          key={time}
                          time={time}
                          value={row[time]}
                          label={`第 ${i + 1} 行`}
                          commit={(value) => {
                            const revised = updateTtml(text, i, { time, value });
                            if (revised === text) notice('无法识别该时间格式。');
                            else update(revised);
                          }}
                        />
                      ))}
                    <div className={s.words}>
                      {(row.slots.length ? row.slots : [{ value: '', begin: null, end: null, timing: false }]).map(
                        (part, slot) => (
                          <div key={slot} className={s.word}>
                            <input
                              aria-label={`第 ${i + 1} 行文本 ${slot + 1}`}
                              value={part.value}
                              size={Math.max(2, Math.min(32, [...part.value].length * 2))}
                              onChange={(e) => update(updateTtml(text, i, { slot, value: e.target.value }))}
                            />
                            {part.timing && (
                              <details>
                                <summary>逐字时间</summary>
                                {(['begin', 'end'] as const).map((time) => (
                                  <TtmlTimeInput
                                    key={time}
                                    time={time}
                                    label={`第 ${i + 1} 行第 ${slot + 1} 段`}
                                    value={part[time] ?? null}
                                    commit={(value) => {
                                      const revised = updateTtml(text, i, { time, value, word: slot });
                                      if (revised === text) notice('无法识别该时间格式。');
                                      else update(revised);
                                    }}
                                  />
                                ))}
                              </details>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ),
            )}
          </div>
        </>
      ) : (
        <LyricTextEditor value={text} update={update} xml={ttml || target.format === 'ttml'} />
      )}
      {ttml && (remoteReference || fields.some((f) => f.format === 'lrc')) && (
        <details ref={matchDetails}>
          <summary>从增强 LRC 迁移译文</summary>
          <Row>
            <label>
              参考来源{' '}
              <select
                value={reference}
                onChange={(e) => {
                  setReference(e.target.value);
                  setPlan(null);
                }}
              >
                <option value="">选择来源</option>
                {remoteReference && <option value="@online">{tx('lyricLookup.onlineReference')}</option>}
                {fields
                  .filter((f) => f.format === 'lrc')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </select>
            </label>
            <select aria-label="目标轨类型" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="translation">译文</option>
              <option value="transliteration">音译</option>
            </select>
            <label>
              语言 <input value={language} size={8} onChange={(e) => setLanguage(e.target.value)} />
            </label>
            <Button
              size="sm"
              disabled={!reference}
              onClick={() =>
                setPlan(
                  reference === '@online' && remoteReference
                    ? translationPlan(text, remoteReference.original, remoteReference.auxiliary)
                    : translationPlan(text, fields.find((f) => f.id === reference)?.text ?? ''),
                )
              }
            >
              生成匹配预览
            </Button>
          </Row>
          {plan && (
            <>
              <p>
                {plan.rows.filter((row) => row.row != null).length} / {plan.rows.length}{' '}
                行已匹配。未匹配的行将保留在参考来源。
              </p>
              <ol className={s.lines}>
                {plan.rows.map((match, i) => (
                  <li key={i}>
                    <div>
                      {match.line} · {match.time.toFixed(2)} 秒
                    </div>
                    <div>{match.translation}</div>
                    <select
                      aria-label={`第 ${i + 1} 行译文的匹配结果`}
                      value={match.row ?? ''}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          rows: plan.rows.map((item, n) =>
                            n === i ? { ...item, row: e.target.value === '' ? null : Number(e.target.value) } : item,
                          ),
                        })
                      }
                    >
                      <option value="">跳过 / 待确认</option>
                      {plan.anchors.map((anchor, row) => (
                        <option key={row} value={row}>
                          {match.suggested.includes(row) ? '建议 · ' : ''}
                          {anchor.time ?? '—'} · {anchor.text}
                        </option>
                      ))}
                    </select>
                    <details>
                      <summary>同时关联到另一行</summary>
                      <select
                        aria-label={`第 ${i + 1} 行译文的第二目标`}
                        value={extraRows[i] ?? -1}
                        onChange={(e) => setExtraRows({ ...extraRows, [i]: Number(e.target.value) })}
                      >
                        <option value={-1}>不添加</option>
                        {plan.anchors.map((anchor, row) => (
                          <option key={row} value={row}>
                            {anchor.time ?? '—'} · {anchor.text}
                          </option>
                        ))}
                      </select>
                    </details>
                  </li>
                ))}
              </ol>
              <Button
                size="sm"
                onClick={() => {
                  const matches = plan.rows.flatMap((row, index) =>
                    extraRows[index] >= 0 ? [row, { ...row, row: extraRows[index] }] : [row],
                  );
                  const result = addTranslations(text, language, matches, role);
                  if (!result) {
                    notice('无法应用译文，请检查文档和语言代码。');
                    return;
                  }
                  update(result.text);
                  notice(`已加入 ${result.added} 行译文到草稿。已有同语言译文保持原样。`);
                }}
              >
                应用到草稿
              </Button>
            </>
          )}
        </details>
      )}
      <Row>
        <Button
          kind="primary"
          size="sm"
          disabled={!writable || (!!field && text === original)}
          onClick={() => mutate(text)}
        >
          写入 {target.label}
        </Button>
        {text !== original && (
          <Button
            size="sm"
            onClick={() => {
              clear();
              setPlan(null);
              notice('');
            }}
          >
            舍弃草稿
          </Button>
        )}
        {field?.writable && (
          <Button size="sm" onClick={() => setConfirmDelete(!confirmDelete)}>
            删除此来源
          </Button>
        )}
      </Row>
      {confirmDelete && (
        <Row>
          <Note>仅删除 {target.label}。</Note>
          <Button size="sm" onClick={() => mutate(null)}>
            确认删除
          </Button>
        </Row>
      )}
      {message && <Note>{message}</Note>}
    </fieldset>
  );
}

function TtmlTimeInput({
  time,
  label,
  value,
  commit,
}: {
  time: 'begin' | 'end';
  label: string;
  value: string | null;
  commit: (value: string) => void;
}) {
  const name = time === 'begin' ? '开始' : '结束';
  return (
    <label>
      {name}{' '}
      <input
        aria-label={label + name}
        key={value}
        defaultValue={value ?? ''}
        onBlur={(e) => {
          const edited = e.currentTarget.value;
          if (edited === (value ?? '')) return;
          e.currentTarget.value = value ?? '';
          commit(edited);
        }}
      />
    </label>
  );
}
