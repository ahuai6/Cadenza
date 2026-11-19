// A ring around a button belongs to the keyboard: it shows where the next key goes. A button pressed with the mouse kept
// the focus, and the next shortcut (the space bar, the arrows, walking in the space) made the browser draw the ring
// round it — left there long after, and the space bar pressing that button again. So a control pressed with the
// pointer lets the focus go once it has done its work; text fields, and anything moved to with the keyboard, keep it.
const KEEPS = 'input, textarea, select, [contenteditable="true"], [role="slider"]';

export function pointerFocusRelease() {
  addEventListener(
    'click',
    (e) => {
      // (detail 0: a click made by the keyboard — Enter or Space on a focused button — keeps its focus)
      if (!(e instanceof MouseEvent) || e.detail === 0) return;
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.matches(KEEPS)) return;
      if (el.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]'))
        requestAnimationFrame(() => {
          if (document.activeElement === el) el.blur();
        });
    },
    true,
  );
}
