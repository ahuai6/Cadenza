import { useEffect, useRef, useState } from 'react';
import { addTranslations, isTtml, parseLyrics, readableTtml } from '../../engine';
import { tx } from '../../i18n';
import { LyricAI, type AiEntry, type AiTranslationRow } from '../bridge';
import { canEdit } from '../editing';
import { Button, Note, Row } from './kit';
import s from './LyricSources.module.css';

const fresh: Omit<AiEntry, 'id'> & { id?: string; key: string } = {
  name: 'OpenAI',
  provider: 'openai',
  base: '',
  protocol: 'chat',
  model: '',
  timeout: 90000,
  language: 'zh-Hans',
  key: '',
};

export function AiLyricTranslation({
  text,
  context,
  apply,
  stageAuxiliary,
}: {
  text: string;
  context: string;
  apply: (value: string) => void;
  stageAuxiliary?: (value: string) => boolean;
}) {
  const api = LyricAI!;
  const [opened, open] = useState(false);
  const [entries, setEntries] = useState<AiEntry[]>([]);
  const [chatgpt, setChatgpt] = useState({ connected: false, inference: false });
  const [entry, setEntry] = useState(fresh);
  const [service, setService] = useState('chatgpt');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [language, setLanguage] = useState('zh-Hans');
  const [instructions, setInstructions] = useState('');
  const native = isTtml(text);
  const [mode, setMode] = useState(native ? 'missing' : 'all');
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(1);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState<{
    text: string;
    language: string;
    rows: AiTranslationRow[];
    replace: boolean;
    stamps: string[];
    lineCount: number;
  } | null>(null);
  const current = useRef(text);
  const request = useRef(0);
  const selection = useRef(service);

  useEffect(() => {
    current.current = text;
    request.current++;
    void api.cancel();
    setDraft(null);
    setBusy((value) => (value === 'translate' ? '' : value));
    return () => {
      request.current++;
      void api.cancel();
    };
  }, [api, text]);
  useEffect(
    () => () => {
      void api.cancelSignIn();
    },
    [api],
  );

  async function refresh() {
    const state = await api.state();
    if (state.ok) {
      setEntries(state.value.entries);
      setChatgpt(state.value.chatgpt);
    } else setNotice(state.why);
  }
  async function control(name: string, action: () => Promise<{ ok: boolean; why?: string }>) {
    setBusy(name);
    setNotice('');
    try {
      const result = await action();
      if (!result.ok) setNotice(result.why || 'network');
      await refresh();
    } catch {
      setNotice('network');
    } finally {
      setBusy('');
    }
  }
  function choose(id: string, options = entries) {
    selection.current = id;
    setService(id);
    setModels([]);
    const selected = options.find((item) => item.id === id);
    setModel(selected?.model || '');
    if (selected?.language) setLanguage(selected.language);
  }
  async function translate() {
    const source = native ? readableTtml(text) : [];
    if (!source || !canEdit()) return;
    const timed = !native && /^\[(?:\d+:\d+|\d+,\d+\])/m.test(text);
    const lines = native
      ? source
          .filter((row) => row.kind === 'main')
          .map((row) => ({ label: row.label, text: row.slots.map((part) => part.value).join(''), stamp: '' }))
      : timed
        ? parseLyrics(text).lines.map((row) => {
            const ms = Math.max(0, Math.round(row.t * 1000));
            const stamp =
              '[' +
              Math.floor(ms / 60000) +
              ':' +
              String(Math.floor(ms / 1000) % 60).padStart(2, '0') +
              '.' +
              String(ms % 1000).padStart(3, '0') +
              ']';
            return { label: null, text: row.text, stamp };
          })
        : text.split(/\r?\n/).map((value) => ({ label: null, text: value, stamp: '' }));
    const existing = new Set(
      source
        .filter((row) => row.kind === 'translation' && row.lang.toLowerCase() === language.toLowerCase())
        .map((row) => row.label)
        .filter(Boolean),
    );
    const rows = lines.flatMap((row, index) => {
      const value = row.text;
      if (
        !value.trim() ||
        (mode === 'missing' && existing.has(row.label)) ||
        (mode === 'range' && (index + 1 < first || index + 1 > last))
      )
        return [];
      return [{ id: 'line-' + index, text: value }];
    });
    if (!rows.length) {
      setNotice('empty');
      return;
    }
    const run = ++request.current;
    setBusy('translate');
    setDraft(null);
    setNotice('');
    try {
      const contextText = [context, ...lines.map((row) => row.text)].join('\n').slice(0, 15000);
      const result = await api.translate({ service, model, language, instructions, context: contextText, rows });
      if (run !== request.current || current.current !== text || !canEdit()) return;
      if (!result.ok) setNotice(result.why === 'timeout' ? 'request-timeout' : result.why);
      else {
        const byId = new Map(result.value.map((row) => [row.id, row]));
        setDraft({
          text,
          language,
          rows: rows.map(({ id }) => byId.get(id)!),
          replace: mode !== 'missing',
          stamps: lines.map((line) => line.stamp),
          lineCount: lines.length,
        });
      }
    } catch {
      if (run === request.current) setNotice('network');
    } finally {
      if (run === request.current) setBusy('');
    }
  }
  return (
    <details
      className={s.ai}
      data-test="lyric-ai"
      onToggle={(event) => {
        if (event.currentTarget.open && !opened) {
          open(true);
          void refresh().catch(() => setNotice('network'));
        }
      }}
    >
      <summary>{tx('lyricAi.title')}</summary>
      {opened && (
        <>
          <details>
            <summary>{tx('lyricAi.settings')}</summary>
            <Row>
              <Button size="sm" disabled={!!busy} onClick={() => void control('login', () => api.signIn())}>
                Continue with ChatGPT
              </Button>
              {busy === 'login' && (
                <Button size="sm" onClick={() => void api.cancelSignIn()}>
                  {tx('lyricAi.cancel')}
                </Button>
              )}
              {chatgpt.connected && (
                <Button disabled={!!busy} size="sm" onClick={() => void control('logout', () => api.signOut())}>
                  {tx('lyricAi.logout')}
                </Button>
              )}
              <span>
                {tx(
                  chatgpt.inference
                    ? 'lyricAi.allowed'
                    : chatgpt.connected
                      ? 'lyricAi.plan-access'
                      : 'lyricAi.disconnected',
                )}
              </span>
            </Row>
            <fieldset disabled={!!busy}>
              <legend>{tx('lyricAi.api')}</legend>
              <Row>
                <label>
                  {tx('lyricAi.configuration')}{' '}
                  <select
                    value={entry.id || ''}
                    onChange={(event) => {
                      const selected = entries.find((item) => item.id === event.target.value);
                      setEntry(selected ? { ...selected, key: '' } : fresh);
                    }}
                  >
                    <option value="">{tx('lyricAi.new')}</option>
                    {entries.map(({ id, name }) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tx('lyricAi.service')}{' '}
                  <select
                    disabled={!!entry.id}
                    value={entry.provider}
                    onChange={(event) => {
                      const provider = event.target.value as AiEntry['provider'];
                      setEntry({
                        ...fresh,
                        provider,
                        name: provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'DeepSeek' : '',
                        model: provider === 'deepseek' ? 'deepseek-flash' : '',
                      });
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="compatible">OpenAI-compatible</option>
                  </select>
                </label>
                <label>
                  {tx('lyricAi.name')}{' '}
                  <input
                    maxLength={80}
                    value={entry.name}
                    onChange={(event) => setEntry({ ...entry, name: event.target.value })}
                  />
                </label>
              </Row>
              <Row>
                {entry.provider === 'compatible' && (
                  <>
                    <label>
                      Base URL{' '}
                      <input
                        type="url"
                        value={entry.base}
                        onChange={(event) => setEntry({ ...entry, base: event.target.value })}
                      />
                    </label>
                    <label>
                      API{' '}
                      <select
                        value={entry.protocol}
                        onChange={(event) =>
                          setEntry({ ...entry, protocol: event.target.value as AiEntry['protocol'] })
                        }
                      >
                        <option value="chat">Chat Completions</option>
                        <option value="responses">Responses</option>
                      </select>
                    </label>
                  </>
                )}
                <label>
                  API Key{' '}
                  <input
                    type="password"
                    autoComplete="off"
                    maxLength={4096}
                    value={entry.key}
                    onChange={(event) => setEntry({ ...entry, key: event.target.value })}
                  />
                </label>
                <label>
                  {tx('lyricAi.model')}{' '}
                  <input
                    maxLength={120}
                    value={entry.model}
                    onChange={(event) => setEntry({ ...entry, model: event.target.value })}
                  />
                </label>
                <label>
                  {tx('lyricAi.language')}{' '}
                  <input
                    maxLength={30}
                    value={entry.language}
                    onChange={(event) => setEntry({ ...entry, language: event.target.value })}
                  />
                </label>
                <label>
                  {tx('lyricAi.timeout')}{' '}
                  <input
                    type="number"
                    min={10}
                    max={180}
                    value={entry.timeout / 1000}
                    onChange={(event) => setEntry({ ...entry, timeout: +event.target.value * 1000 })}
                  />
                </label>
              </Row>
              <Row>
                <Button
                  size="sm"
                  disabled={!entry.name.trim() || (!entry.id && !entry.key)}
                  onClick={() => {
                    const payload = entry;
                    setEntry({ ...entry, key: '' });
                    void control('save', async () => {
                      const result = await api.save(payload);
                      if (result.ok) {
                        setEntry({ ...result.value, key: '' });
                        choose(result.value.id, [...entries.filter(({ id }) => id !== result.value.id), result.value]);
                      }
                      return result;
                    });
                  }}
                >
                  {tx('lyricAi.save')}
                </Button>
                {entry.id && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void control('remove', async () => {
                        const result = await api.remove(entry.id!);
                        if (result.ok) {
                          setEntry(fresh);
                          if (service === entry.id) choose('chatgpt');
                        }
                        return result;
                      })
                    }
                  >
                    {tx('lyricAi.remove')}
                  </Button>
                )}
              </Row>
            </fieldset>
          </details>
          <Row>
            <label>
              {tx('lyricAi.service')}{' '}
              <select disabled={!!busy} value={service} onChange={(event) => choose(event.target.value)}>
                <option value="chatgpt">ChatGPT</option>
                {entries.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void control('models', async () => {
                  const result = await api.models(service);
                  if (result.ok && selection.current === service) {
                    setModels(result.value);
                    if (!model) setModel(result.value[0] || '');
                    setNotice('connection-ok');
                  }
                  return result;
                })
              }
            >
              {tx('lyricAi.models')}
            </Button>
            <label>
              {tx('lyricAi.model')}{' '}
              <input
                maxLength={120}
                disabled={!!busy}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            {models.length > 0 && (
              <select
                aria-label={tx('lyricAi.models')}
                disabled={!!busy}
                value={models.includes(model) ? model : ''}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="">{tx('lyricAi.model')}</option>
                {models.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            )}
            <label>
              {tx('lyricAi.language')}{' '}
              <input
                disabled={!!busy}
                maxLength={30}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              />
            </label>
            <label>
              {tx('lyricAi.range')}{' '}
              <select disabled={!!busy} value={mode} onChange={(event) => setMode(event.target.value)}>
                {native && <option value="missing">{tx('lyricAi.missing')}</option>}
                <option value="all">{tx('lyricAi.all')}</option>
                <option value="range">{tx('lyricAi.range')}</option>
              </select>
            </label>
            {mode === 'range' && (
              <>
                <label>
                  {tx('lyricAi.first')}{' '}
                  <input
                    type="number"
                    min={1}
                    value={first}
                    disabled={!!busy}
                    onChange={(event) => setFirst(+event.target.value)}
                  />
                </label>
                <label>
                  {tx('lyricAi.last')}{' '}
                  <input
                    type="number"
                    min={first}
                    value={last}
                    disabled={!!busy}
                    onChange={(event) => setLast(+event.target.value)}
                  />
                </label>
              </>
            )}
          </Row>
          <label>
            {tx('lyricAi.instructions')}{' '}
            <input
              maxLength={1500}
              disabled={!!busy}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <Note>{tx('lyricAi.privacy')}</Note>
          <Row>
            <Button size="sm" disabled={!!busy || !model.trim()} onClick={() => void translate()}>
              {tx('lyricAi.translate')}
            </Button>
            {busy === 'translate' && (
              <Button size="sm" onClick={() => void api.cancel()}>
                {tx('lyricAi.cancel')}
              </Button>
            )}
          </Row>
          {notice && (
            <div role="status">
              <Note>
                {tx('lyricAi.' + notice) === 'lyricAi.' + notice
                  ? tx('lyricAi.failed') + ' (' + notice + ')'
                  : tx('lyricAi.' + notice)}
              </Note>
            </div>
          )}
          {draft && (
            <div className={s.lines}>
              {draft.rows.map((row) => (
                <label className={s.line} key={row.id}>
                  {Number(row.id.slice(5)) + 1}
                  <input
                    value={row.translation}
                    maxLength={4000}
                    onChange={(event) => {
                      const translation = event.target.value;
                      setDraft({
                        ...draft,
                        rows: draft.rows.map((item) => (item.id === row.id ? { ...item, translation } : item)),
                      });
                    }}
                  />
                </label>
              ))}
              <Row>
                <Button
                  size="sm"
                  disabled={draft.text !== text || draft.rows.some((row) => !row.translation.trim())}
                  onClick={() => {
                    if (!canEdit() || draft.text !== current.current) return;
                    if (!native) {
                      const translated = new Map(draft.rows.map((row) => [Number(row.id.slice(5)), row.translation]));
                      const value = Array.from(
                        { length: draft.lineCount },
                        (_, index) => draft.stamps[index] + (translated.get(index) || ''),
                      ).join('\n');
                      if (stageAuxiliary?.(value)) setDraft(null);
                      else setNotice('auxiliary-exists');
                      return;
                    }
                    const result = addTranslations(
                      text,
                      draft.language,
                      draft.rows.map((row) => ({
                        row: Number(row.id.slice(5)),
                        translation: row.translation,
                      })),
                      'translation',
                      draft.replace,
                    );
                    if (result?.added) {
                      apply(result.text);
                      setDraft(null);
                      setNotice('applied');
                    } else setNotice('unchanged');
                  }}
                >
                  {tx('lyricAi.apply')}
                </Button>
                <Button size="sm" onClick={() => setDraft(null)}>
                  {tx('lyricAi.cancel')}
                </Button>
              </Row>
            </div>
          )}
        </>
      )}
    </details>
  );
}
