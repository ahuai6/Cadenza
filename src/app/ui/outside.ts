// A card opened over the page (a list, a panel, an album opened where you stand) goes away when the pointer is pressed
// anywhere outside it: on the empty page, the scene, the stage. Pressing on what opened it, on a menu or a dialog it
// opened, or on another card that asks to stay (data-keep-open), leaves it as it is.
import { useEffect } from 'react';

const KEEP = '[role="menu"], [role="listbox"], [role="dialog"], [data-keep-open], [data-toast]';

export function useOutsideClose(open: boolean, onClose: () => void, ...inside: string[]) {
  useEffect(() => {
    if (!open) return;
    const sel = [KEEP, ...inside].join(', ');
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      if (!t || !t.isConnected || t.closest(sel)) return;
      onClose();
    };
    // (on the capture: a press the scene or the stage takes for itself still closes the card)
    addEventListener('pointerdown', down, true);
    return () => removeEventListener('pointerdown', down, true);
  }, [open, onClose, ...inside]);
}
