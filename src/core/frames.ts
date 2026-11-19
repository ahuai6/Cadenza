/**
 * A frame loop that does not stand still while the page is shown but the browser has stopped giving it frames.
 *
 * On Windows a screen recorder's overlay over the window, or some capture tools, can make the browser take the window
 * for covered and stop its animation frames, while the song plays on: the picture froze. The loop draws from its
 * own browser frames as usual; should none come for `stall` ms while the page is visible, a timer draws in their
 * place at a steady rate until they come back. Only ever one chain of frames: a frame the timer drew replaces the
 * browser's next, never adds a second.
 */
export interface FrameLoop {
  stop(): void;
  /** how many times the browser's frames stopped and the timer took over (shown in the diagnostics) */
  stalls(): number;
}

// (stall: a second with no frame to begin with. A slow graphics card — each frame a few hundred ms in coming — can
// look like a stall; the timer's extra frames then pile more work onto the card. So when the browser's frames come back
// soon after the timer took over (it was slowness, not a covered window) the wait doubles, up to MAX_STALL: on such a
// machine the timer steps in only when the frames really stop, as under a recorder's overlay, for seconds at a time)
const MAX_STALL = 8000,
  SHORT = 3000;
export function frameLoop(step: (now: number) => void, stall = 1000, tick = 33): FrameLoop {
  let raf = 0,
    last = performance.now(),
    covering = 0, // (when the timer took over; 0: the browser's frames are coming)
    stalls = 0,
    wait = stall,
    on = true;
  const frame = (now: number) => {
    if (!on) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fromBrowser);
    step(now);
    // (measured from the frame's end: a single slow frame is not a stall)
    last = performance.now();
  };
  const fromBrowser = (now: number) => {
    if (covering && performance.now() - covering < SHORT) wait = Math.min(MAX_STALL, wait * 2);
    covering = 0;
    frame(now);
  };
  raf = requestAnimationFrame(fromBrowser);
  const watch = setInterval(() => {
    // (once the timer has taken over it draws every tick, until the browser's frames come back)
    if (!on || document.visibilityState !== 'visible' || (!covering && performance.now() - last < wait)) return;
    if (!covering) {
      stalls++;
      covering = performance.now();
    }
    frame(performance.now());
  }, tick);
  return {
    stop() {
      on = false;
      cancelAnimationFrame(raf);
      clearInterval(watch);
    },
    stalls: () => stalls,
  };
}
