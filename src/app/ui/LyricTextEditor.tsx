import { useRef, useState } from 'react';
import { CueBar, cueKeyDown } from './cues';
import { Button, Row } from './kit';
import s from './LyricSources.module.css';

export function LyricTextEditor({
  value,
  update,
  xml,
  label,
  className,
}: {
  value: string;
  update: (text: string) => void;
  xml: boolean;
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<'find' | 'replace' | null>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [mode, setMode] = useState('literal');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [shift, setShift] = useState('0');
  const [message, notice] = useState('');
  const [history, setHistory] = useState<{ undo: string[]; redo: string[] }>({ undo: [], redo: [] });
  function edit(next: string) {
    if (next === value) return;
    setHistory({ undo: [...history.undo.slice(-24), value], redo: [] });
    update(next);
  }
  function undo(redo = false) {
    const from = redo ? history.redo : history.undo;
    if (!from.length) return;
    update(from[from.length - 1]);
    setHistory(
      redo
        ? { undo: [...history.undo, value], redo: from.slice(0, -1) }
        : { undo: from.slice(0, -1), redo: [...history.redo, value] },
    );
  }
  function matches() {
    if (!query || query.length > 256) return [];
    try {
      const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern =
        mode === 'regex'
          ? query
          : mode === 'wildcard'
            ? query
                .split(/([*?])/)
                .map((part) => (part === '*' ? '[^\\r\\n]*?' : part === '?' ? '[^\\r\\n]' : escape(part)))
                .join('')
            : escape(query);
      const check = whole ? '(?<![\\p{L}\\p{N}_])(?:' + pattern + ')(?![\\p{L}\\p{N}_])' : pattern;
      return [...value.matchAll(new RegExp(check, matchCase ? 'gu' : 'giu'))].filter((match) => match[0].length);
    } catch {
      notice('搜索表达式不合法。');
      return null;
    }
  }
  function move(previous: boolean) {
    const el = input.current;
    const hit = matches();
    if (!el || !hit) return;
    const match = previous
      ? (hit.findLast((item) => item.index < el.selectionStart) ?? hit[hit.length - 1])
      : (hit.find((item) => item.index >= el.selectionEnd) ?? hit[0]);
    notice(match ? `共 ${hit.length} 项` : '没有匹配项。');
    if (match) {
      el.focus();
      el.setSelectionRange(match.index, match.index + match[0].length);
    }
  }
  function replace(scope: 'selected' | 'selection' | 'all') {
    const el = input.current;
    const hit = matches();
    if (!el || !hit) return;
    const selected = hit.filter(
      (item) =>
        scope === 'all' ||
        (scope === 'selection'
          ? item.index >= el.selectionStart && item.index + item[0].length <= el.selectionEnd
          : item.index === el.selectionStart && item.index + item[0].length === el.selectionEnd),
    );
    // LRC timestamps, headers and inline word anchors are deliberately edited by direct input.
    const protectedTokens = xml
      ? []
      : [...value.matchAll(/\[\d+:\d{1,2}(?:[.:]\d+)?\]|<\d+:\d{1,2}(?:[.:]\d+)?>|^\[[A-Za-z]+:[^\r\n\]]*\]/gm)];
    const edits = selected.filter(
      (match) =>
        !protectedTokens.some(
          (token) => token.index < match.index + match[0].length && match.index < token.index + token[0].length,
        ),
    );
    const parts: string[] = [];
    let at = 0;
    for (const match of edits) {
      parts.push(value.slice(at, match.index), replacement);
      at = match.index + match[0].length;
    }
    parts.push(value.slice(at));
    edit(parts.join(''));
    notice(`已替换 ${edits.length} 项。` + (edits.length !== selected.length ? ' 已保留时间与元数据标记。' : ''));
  }
  return (
    <div
      className={s.editor}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || !e.ctrlKey || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 'f' || key === 'h') {
          e.preventDefault();
          setPanel(key === 'h' ? 'replace' : 'find');
          requestAnimationFrame(() => find.current?.focus());
        } else if (key === 'z' || key === 'y') {
          if (e.target !== input.current) return;
          e.preventDefault();
          undo(key === 'y' || e.shiftKey);
        }
      }}
    >
      <Row>
        <Button size="sm" onClick={() => setPanel(panel ? null : 'replace')}>
          查找与替换
        </Button>
        <Button size="sm" disabled={!history.undo.length} onClick={() => undo()}>
          撤销
        </Button>
        <Button size="sm" disabled={!history.redo.length} onClick={() => undo(true)}>
          重做
        </Button>
      </Row>
      {panel && (
        <div className={s.editor}>
          <Row>
            <label>
              查找 <input ref={find} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <select aria-label="匹配方式" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="literal">普通文本</option>
              <option value="wildcard">通配符</option>
              <option value="regex">正则表达式</option>
            </select>
            <label>
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
              区分大小写
            </label>
            <label>
              <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
              全词
            </label>
            <Button size="sm" onClick={() => move(true)}>
              上一项
            </Button>
            <Button size="sm" onClick={() => move(false)}>
              下一项
            </Button>
          </Row>
          {panel === 'replace' && (
            <Row>
              <label>
                替换为 <input value={replacement} onChange={(e) => setReplacement(e.target.value)} />
              </label>
              <Button size="sm" onClick={() => replace('selected')}>
                替换当前项
              </Button>
              <Button size="sm" onClick={() => replace('selection')}>
                在选区替换
              </Button>
              <Button size="sm" onClick={() => replace('all')}>
                全部替换
              </Button>
            </Row>
          )}
          {message && <span role="status">{message}</span>}
        </div>
      )}
      {!xml && (
        <details>
          <summary>批量调整时间戳</summary>
          <Row>
            <label>
              偏移毫秒 <input type="number" value={shift} onChange={(e) => setShift(e.target.value)} />
            </label>
            <Button
              size="sm"
              disabled={!Number(shift) || !Number.isSafeInteger(Number(shift))}
              onClick={() => {
                let count = 0;
                let negative = false;
                const milliseconds = Number(shift);
                const adjusted = value.replace(
                  /(\[|<)(\d+):(\d{1,2})(?:[.:](\d{1,3}))?(\]|>)/g,
                  (
                    original,
                    open: string,
                    minutes: string,
                    seconds: string,
                    fraction: string | undefined,
                    close: string,
                  ) => {
                    if ((open === '[') !== (close === ']')) return original;
                    const total =
                      (Number(minutes) * 60 + Number(seconds)) * 1000 +
                      Number((fraction ?? '').padEnd(3, '0')) +
                      milliseconds;
                    if (total < 0 || !Number.isSafeInteger(total)) {
                      negative = true;
                      return original;
                    }
                    count++;
                    return (
                      open +
                      String(Math.floor(total / 60000)).padStart(2, '0') +
                      ':' +
                      String(Math.floor(total / 1000) % 60).padStart(2, '0') +
                      '.' +
                      String(total % 1000).padStart(3, '0') +
                      close
                    );
                  },
                );
                if (negative) {
                  notice('部分时间戳超出可表示范围。草稿保持原样。');
                  return;
                }
                edit(adjusted);
                notice(`已调整 ${count} 个时间戳，可撤销。`);
              }}
            >
              应用偏移
            </Button>
          </Row>
          {message && !panel && <span role="status">{message}</span>}
        </details>
      )}
      {!xml && <CueBar target={input} />}
      <label className={s.editor}>
        {label || (xml ? 'TTML XML' : '歌词正文')}
        <textarea
          className={className}
          ref={input}
          value={value}
          spellCheck={false}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={
            xml
              ? undefined
              : (e) => {
                  if (!e.nativeEvent.isComposing) cueKeyDown(e);
                }
          }
        />
      </label>
    </div>
  );
}
