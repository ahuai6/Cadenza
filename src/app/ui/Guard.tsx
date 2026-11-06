// One part of the interface failing must never take the whole window with it (a render error unmounts everything above
// the nearest boundary: with none, the window goes white). Each large part sits in a Guard: on an error it shows nothing,
// notes the error in the debug log and the console, and tries again when its key changes (a new song, a new page).
import { Component, type ReactNode } from 'react';
import { DEBUG } from '../../engine';

export class Guard extends Component<{ name: string; k?: unknown; children: ReactNode }, { failed: unknown }> {
  override state = { failed: null as unknown };
  static getDerivedStateFromError(e: unknown) { return { failed: e ?? true }; }
  override componentDidCatch(e: unknown, info: { componentStack?: string | null }) {
    try { DEBUG.event('ui part failed', { part: this.props.name, error: String((e as Error)?.stack || e), at: info.componentStack?.slice(0, 1200) }); } catch { /* never in the way */ }
    console.error(`[${this.props.name}]`, e);
  }
  override componentDidUpdate(prev: { k?: unknown }) { if (this.state.failed && prev.k !== this.props.k) this.setState({ failed: null }); }
  override render() { return this.state.failed ? null : this.props.children; }
}
