// The cue symbols in a lyric editor: a row of keys over the text, each typing its symbol at the cursor (Alt + its key
// does the same from the keyboard). The symbols come from the lyrics' own list (CUE_SYMBOLS), so a new kind of cue
// shows up in every editor without touching them.
import type { KeyboardEvent, RefObject } from 'react';
import { CUE_SYMBOLS } from '../../engine';
import { tx } from '../../i18n';
import s from './cues.module.css';

/** Type text at a text area's cursor (over its selection), as typing would: it can be undone, and the area's change
 *  handler sees it. */
export function typeAt(ta: HTMLTextAreaElement, text: string) {
  ta.focus();
  if (document.execCommand?.('insertText', false, text)) return;
  ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
/** Alt + a cue's key, in the text area: its symbol at the cursor. */
export function cueKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const c = CUE_SYMBOLS.find((x) => e.code === 'Digit' + x.key || e.code === 'Numpad' + x.key || e.key === x.key);
  if (!c) return;
  e.preventDefault();
  typeAt(e.currentTarget, c.text);
}
export function CueBar({ target }: { target: RefObject<HTMLTextAreaElement | null> }) {
  return (
    <div className={s.bar} role="toolbar" aria-label={tx('lyr.cues')}>
      <span className={s.label}>{tx('lyr.cues')}</span>
      {CUE_SYMBOLS.map((c) => (
        // (the text keeps its focus and cursor: the key never takes them)
        <button
          key={c.text}
          type="button"
          className={s.key}
          title={tx('lyr.cue.insert', { s: c.text, k: c.key })}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => target.current && typeAt(target.current, c.text)}
        >
          <code>{c.text}</code>
          <span>{tx(c.label)}</span>
          <kbd>Alt+{c.key}</kbd>
        </button>
      ))}
    </div>
  );
}
