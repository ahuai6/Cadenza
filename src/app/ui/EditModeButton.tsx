import { tx } from '../../i18n';
import { toggleEditing, useEditing, useEditSwitch } from '../editing';
import { Icon } from './icons';
import { usePresence } from './kit';
import type { ReactNode } from 'react';
import s from './EditModeButton.module.css';

export function EditModeButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const on = useEditing(),
    switching = useEditSwitch();
  return (
    <button
      type="button"
      className={className}
      data-feedback=""
      data-test="edit-mode"
      aria-label={tx('edit.mode')}
      aria-pressed={on}
      aria-keyshortcuts="Control+Shift+E"
      title={`${tx('edit.mode')} · Ctrl+Shift+E`}
      disabled={switching}
      onClick={() => void toggleEditing()}
    >
      <Icon n="pencil" size={16} />
      {!compact && <span>{tx('edit.mode')}</span>}
    </button>
  );
}

export function EditControls({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  const enabled = useEditing();
  const { shown } = usePresence(enabled, '--t-med');
  return (
    <div className={s.fold} data-open={enabled} data-inline={inline || undefined} inert={!enabled}>
      <div>{shown && children}</div>
    </div>
  );
}
