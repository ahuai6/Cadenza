import { useEffect, useId, useRef, useState } from 'react';
import {
  hallApi,
  type HallCapability,
  type HallPage,
  type HallPreview,
  type HallProvider,
  type HallTrack,
  type HallSnapshot,
  type HallTier,
} from '../../hall/api';
import { Icon } from '../../ui/icons';
import s from './MusicHall.module.css';

const modes = [
  ['recommendations', '推荐'],
  ['charts', '榜单'],
] as const;
const errors: Record<string, string> = {
  'provider-failed': '来源暂时无法响应，请重试。',
  'not-found': '没有可用内容。',
  'invalid-response': '来源返回了无法识别的内容。',
  'rate-limit': '请求过于频繁，请稍后重试。',
  timeout: '等待来源响应超时。',
  restricted: '当前地区或资源权限不允许该操作。',
  unavailable: '该来源尚未提供此能力。',
};
function duration(value?: number) {
  if (!value || value < 0) return '';
  return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0');
}
type Query = { kind: HallCapability; query?: string; track?: HallTrack; offset: number; region: string };
const pages = new Map<string, { data: HallPage; expiry: number }>();
const empty: HallPage = { rows: [], more: false };
const remembered = new Map<
  string,
  { search: string; region: string; query: Query | null; page: HallPage; scroll: number }
>();
export function Catalog({ provider, accounts }: { provider: HallProvider; accounts: HallSnapshot['accounts'] }) {
  const id = useId();
  const prior = remembered.get(provider.id);
  const [search, setSearch] = useState(prior?.search || '');
  const [region, setRegion] = useState(prior?.region || 'us');
  const [query, setQuery] = useState<Query | null>(prior?.query ?? null);
  const [page, setPage] = useState<HallPage>(prior?.page || empty);
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [pendingPreview, setPendingPreview] = useState('');
  const [preview, setPreview] = useState<HallPreview | null>(null);
  const [lyrics, setLyrics] = useState<{ name: string; text: string; format: string } | null>(null);
  const [account, setAccount] = useState('');
  const [download, setDownload] = useState<HallTrack | null>(null);
  const [tier, setTier] = useState<HallTier>('standard');
  const [conflict, setConflict] = useState<'keep' | 'skip'>('keep');
  const [adding, setAdding] = useState(false);
  const availableAccounts = accounts.filter((item) => item.provider === provider.id && item.state === 'connected');
  const activeAccount = availableAccounts.find((item) => item.id === account) ?? availableAccounts[0];
  const run = useRef(0);
  const previewRun = useRef(0);
  const history = useRef<{ query: Query; data: HallPage; scroll: number }[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const apply = async (value: Query) => {
    if (!hallApi) return;
    const number = ++run.current;
    const key = JSON.stringify([provider.id, value.kind, value.query, value.track?.ref.id, value.offset, value.region]);
    setQuery(value);
    setNotice('');
    const merge = (found: HallPage) =>
      setPage((current) => (value.offset ? { rows: [...current.rows, ...found.rows], more: found.more } : found));
    const cached = pages.get(key);
    if (cached && cached.expiry > Date.now()) {
      merge(cached.data);
      setWorking(false);
      return;
    }
    setWorking(true);
    try {
      const result = await hallApi.catalog(provider.id, value.kind, {
        query: value.query,
        id: value.track?.ref.id,
        namespace: value.track?.ref.namespace,
        offset: value.offset,
        region: value.region,
      });
      if (run.current !== number) return;
      if (!result.ok) {
        if (result.code !== 'cancelled') setNotice(errors[result.code] || errors['provider-failed']);
        return;
      }
      if (result.data) {
        if (pages.size >= 36) pages.delete(pages.keys().next().value!);
        pages.set(key, { data: result.data, expiry: Date.now() + 120_000 });
        merge(result.data);
      }
    } catch {
      if (run.current === number) setNotice(errors['provider-failed']);
    } finally {
      if (run.current === number) setWorking(false);
    }
  };
  useEffect(() => {
    const off = hallApi?.onPreview(setPreview);
    if (prior) requestAnimationFrame(() => frame()?.scrollTo(0, prior.scroll));
    else if (provider.capabilities.recommendations === 'public')
      void apply({ kind: 'recommendations', offset: 0, region });
    return () => {
      run.current++;
      previewRun.current++;
      off?.();
      void hallApi?.cancel(provider.id, 'search');
      void hallApi?.cancel(provider.id, 'browse');
      void hallApi?.cancel(provider.id, 'playlists');
    };
  }, [provider.id]);
  useEffect(() => {
    if (page.syncedAt) return;
    remembered.set(provider.id, { search, region, query, page, scroll: frame()?.scrollTop ?? 0 });
    const node = frame();
    const saveScroll = () => {
      const saved = remembered.get(provider.id);
      if (saved && node) saved.scroll = node.scrollTop;
    };
    node?.addEventListener('scroll', saveScroll, { passive: true });
    return () => node?.removeEventListener('scroll', saveScroll);
  }, [search, region, query, page, provider.id]);
  async function command(kind: 'open' | 'preview', row: HallTrack) {
    const ticket = ++previewRun.current;
    if (kind === 'preview') setPendingPreview(row.ref.id);
    setNotice('');
    try {
      const answer = await hallApi!.catalog(provider.id, kind, {
        id: row.ref.id,
        namespace: row.ref.namespace,
        region: row.ref.availability.storefront || region,
      });
      if (ticket === previewRun.current && !answer.ok && answer.code !== 'cancelled')
        setNotice(errors[answer.code] || errors['provider-failed']);
    } catch {
      if (ticket === previewRun.current) setNotice(errors['provider-failed']);
    } finally {
      if (ticket === previewRun.current) setPendingPreview('');
    }
  }
  async function syncPlaylists(refresh: boolean, track?: HallTrack) {
    if (!activeAccount || !hallApi) return;
    const number = ++run.current;
    setWorking(true);
    setNotice('');
    try {
      const result = await hallApi.playlists(provider.id, { account: activeAccount.id, refresh, id: track?.ref.id });
      if (number !== run.current) return;
      if (!result.ok) {
        if (result.previous) setPage(result.previous);
        setNotice(result.code === 'expired' ? '账号已失效，请重新登录。' : '同步未完成，已保留上次完整结果。');
      } else {
        setQuery(null);
        setPage(result.data);
      }
    } catch {
      if (number === run.current) setNotice('同步暂时失败。');
    } finally {
      if (number === run.current) setWorking(false);
    }
  }
  async function readLyrics(track: HallTrack) {
    const number = ++previewRun.current;
    setLyrics(null);
    try {
      const result = await hallApi!.catalog(provider.id, 'lyrics', {
        id: track.ref.id,
        region: track.ref.availability.storefront,
      });
      if (number !== previewRun.current) return;
      if (result.ok && result.lyrics) setLyrics({ ...result.lyrics, name: track.title });
      else setNotice(result.ok ? '没有歌词。' : errors[result.code] || '歌词无法读取。');
    } catch {
      if (number === previewRun.current) setNotice('歌词无法读取。');
    }
  }
  const frame = () => list.current?.closest('[data-test="hall-scroll"]');
  return (
    <section className={s.catalog} aria-label="在线目录">
      <form
        className={s.catalogSearch}
        onSubmit={(event) => {
          event.preventDefault();
          if (search.trim()) void apply({ kind: 'search', offset: 0, query: search.trim(), region });
        }}
      >
        <label htmlFor={id}>歌曲搜索</label>
        <input
          id={id}
          type="search"
          placeholder="输入歌曲或艺人"
          value={search}
          maxLength={120}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        {['lyricsflow', 'apple'].includes(provider.id) && (
          <select aria-label="目录地区" value={region} onChange={(event) => setRegion(event.currentTarget.value)}>
            <option value="us">美国</option>
            <option value="cn">中国大陆</option>
            <option value="jp">日本</option>
            <option value="gb">英国</option>
          </select>
        )}
        <button type="submit" disabled={!search.trim()}>
          搜索
        </button>
      </form>
      {activeAccount && provider.capabilities.playlists === 'authorized' && (
        <div className={s.catalogTabs}>
          <label>
            歌单账号{' '}
            <select
              value={activeAccount.id}
              onChange={(event) => {
                run.current++;
                void hallApi?.cancel(provider.id, 'playlists');
                setAccount(event.target.value);
                setPage(empty);
                setQuery(null);
                setWorking(false);
              }}
            >
              {availableAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void syncPlaylists(false)}>
            我的歌单
          </button>
          <button type="button" disabled={working} onClick={() => void syncPlaylists(true)}>
            同步歌单
          </button>
          {page.syncedAt && <small>同步于 {new Date(page.syncedAt).toLocaleString()}</small>}
        </div>
      )}
      {download && activeAccount && (
        <section className={s.block} aria-label="确认加入曲库">
          <strong>{download.title}</strong>
          <div className={s.catalogTabs}>
            <label>
              音质{' '}
              <select value={tier} onChange={(event) => setTier(event.target.value as HallTier)}>
                <option value="standard">标准</option>
                <option value="high">高码率</option>
                <option value="lossless">无损</option>
              </select>
            </label>
            <label>
              重名时{' '}
              <select value={conflict} onChange={(event) => setConflict(event.target.value as 'keep' | 'skip')}>
                <option value="keep">保留两份</option>
                <option value="skip">跳过</option>
              </select>
            </label>
            <button
              type="button"
              disabled={adding}
              onClick={async () => {
                setAdding(true);
                try {
                  const result = await hallApi!.downloadAdd(provider.id, {
                    track: download.ref.id,
                    account: activeAccount.id,
                    title: download.title,
                    tier,
                    conflict,
                  });
                  if (result.ok) {
                    setDownload(null);
                    setNotice('已排队，请在下载任务查看进度。');
                  } else if (result.code !== 'cancelled') setNotice(errors[result.code] || '无法加入下载队列。');
                } catch {
                  setNotice('无法加入下载队列。');
                } finally {
                  setAdding(false);
                }
              }}
            >
              选择目录并下载
            </button>
            <button type="button" onClick={() => setDownload(null)}>
              取消
            </button>
          </div>
        </section>
      )}
      {lyrics && (
        <details open className={s.block}>
          <summary>
            {lyrics.name} · {lyrics.format.toUpperCase()}
          </summary>
          <pre tabIndex={0} className={s.onlineLyrics}>
            {lyrics.text}
          </pre>
          <button type="button" onClick={() => setLyrics(null)}>
            关闭歌词
          </button>
        </details>
      )}
      <div className={s.catalogTabs}>
        {modes
          .filter(([mode]) => provider.capabilities[mode] === 'public')
          .map(([mode, title]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={query?.kind === mode}
              onClick={() => void apply({ kind: mode, offset: 0, region })}
            >
              {title}
            </button>
          ))}
        {history.current.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const back = history.current.pop()!;
              run.current++;
              void hallApi?.cancel(provider.id, 'browse');
              setQuery(back.query);
              setPage(back.data);
              setWorking(false);
              setNotice('');
              requestAnimationFrame(() => frame()?.scrollTo(0, back.scroll));
            }}
          >
            返回列表
          </button>
        )}
      </div>
      {preview?.provider === provider.id && ['buffering', 'playing'].includes(preview.phase) && (
        <div className={s.previewBar}>
          <span>
            {preview.phase === 'buffering' ? '试听缓冲' : '正在试听'}
            {preview.title ? ' · ' + preview.title : ''}
          </span>
          <progress aria-label="试听进度" max={preview.duration} value={preview.position} />
          <span>
            {duration(preview.position) || '0:00'} / {duration(preview.duration)}
          </span>
          <button type="button" onClick={() => void hallApi?.stopPreview()}>
            结束试听
          </button>
        </div>
      )}
      {notice && (
        <p role="status">
          {notice}{' '}
          {query && (
            <button type="button" onClick={() => void apply(query)}>
              重试
            </button>
          )}
        </p>
      )}
      {!notice && working && <p role="status">正在获取目录…</p>}
      {!working && !notice && query && !page.rows.length && <p role="status">未找到内容。</p>}
      <div ref={list} aria-busy={working}>
        {page.rows.length > 0 && (
          <ul className={s.trackList}>
            {page.rows.map((track, index) => (
              <li key={track.ref.namespace + ':' + track.ref.id + ':' + index} className={s.trackRow}>
                {track.image ? (
                  <img src={track.image} loading="lazy" decoding="async" alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className={s.coverFallback}>
                    <Icon n="note" size={17} />
                  </span>
                )}
                <span className={s.trackText}>
                  <b title={track.title}>{track.title}</b>
                  <small>{[track.artist, track.album].filter(Boolean).join(' · ')}</small>
                </span>
                <span className={s.trackDuration}>{duration(track.duration)}</span>
                <div className={s.trackActions}>
                  {track.ref.namespace !== 'songs' && provider.capabilities.collection === 'public' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (query) history.current.push({ query, data: page, scroll: frame()?.scrollTop || 0 });
                        if (track.ref.access.kind === 'account') void syncPlaylists(false, track);
                        else
                          void apply({
                            kind: 'collection',
                            track,
                            offset: 0,
                            region: track.ref.availability.storefront || region,
                          });
                      }}
                    >
                      查看
                    </button>
                  )}
                  {track.preview && provider.capabilities.preview === 'public' && (
                    <button
                      type="button"
                      disabled={pendingPreview === track.ref.id}
                      onClick={() => void command('preview', track)}
                    >
                      {pendingPreview === track.ref.id ? '准备中' : '试听'}
                    </button>
                  )}
                  {provider.capabilities.lyrics === 'public' && track.ref.namespace === 'songs' && (
                    <button type="button" onClick={() => void readLyrics(track)}>
                      歌词
                    </button>
                  )}
                  {activeAccount &&
                    provider.capabilities.download === 'authorized' &&
                    track.ref.namespace === 'songs' && (
                      <button
                        type="button"
                        onClick={() => {
                          setDownload(track);
                          setNotice('');
                          frame()?.scrollTo(0, 0);
                        }}
                      >
                        加入资料库
                      </button>
                    )}
                  {provider.capabilities.open === 'public' && (
                    <button type="button" onClick={() => void command('open', track)}>
                      打开官网
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {page.more && query && (
        <button
          className={s.more}
          type="button"
          disabled={working || !!notice}
          onClick={() => void apply({ ...query, offset: query.offset + 25 })}
        >
          加载更多
        </button>
      )}
    </section>
  );
}
