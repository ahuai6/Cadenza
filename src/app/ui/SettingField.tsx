// A setting drawn from its declaration (settings/schema.ts): a switch, a row of choices or a slider, named from its
// label. Shared by both interfaces' settings pages; each page passes its own row (`frame`) for a labelled control.
// A new setting with a label shows on a page by being placed there by its key, with nothing else written.
import type { ReactNode } from 'react';
import { tx } from '../../i18n';
import { settings, useStore } from '../state';
import type { Settings } from '../bridge';
import { setSettings } from '../actions/settings';
import { SCHEMA, type SettingKey } from '../settings/schema';
import { Seg, Toggle, Slider } from './kit';

/** A page's row for a labelled control (the switch and the slider carry their own label). */
export type Frame = (p: { label: string; help?: string; children: ReactNode }) => ReactNode;

interface Decl {
  kind: string;
  label?: string;
  help?: string;
  options?: readonly (string | number)[];
  min?: number;
  max?: number;
  step?: number;
  default: unknown;
  optionLabel?: (o: string | number) => [string, Record<string, number>?];
  optionHelp?: (o: string | number) => string;
  unit?: 'percent' | 'times';
}

const written = (unit: Decl['unit'], v: number) =>
  unit === 'percent' ? Math.round(v * 100) + '%' : unit === 'times' ? v.toFixed(1) + '×' : String(v);

export function SettingField({ k, frame, fit = true }: { k: SettingKey; frame: Frame; fit?: boolean }) {
  const st = useStore(settings),
    d = SCHEMA[k] as Decl;
  if (!d.label) return null;
  const raw = (st as Record<string, unknown>)[k],
    value = raw ?? d.default,
    put = (v: unknown) => setSettings({ [k]: v } as Partial<Settings>);
  if (d.kind === 'toggle')
    return <Toggle label={tx(d.label)} help={d.help ? tx(d.help) : undefined} on={!!value} set={put} />;
  if (d.kind === 'range')
    return (
      <Slider
        label={tx(d.label)}
        value={typeof value === 'number' ? value : (d.default as number)}
        min={d.min!}
        max={d.max!}
        step={d.step!}
        onCommit={put}
        format={(v) => written(d.unit, v)}
      />
    );
  if (d.kind === 'choice') {
    const name = (o: string | number) => {
      const [key, vars] = d.optionLabel ? d.optionLabel(o) : [d.label + '.' + o];
      return tx(key, vars);
    };
    // (the options as strings for the control; the value written back in the option's own type)
    const opts = d.options!,
      cur = opts.find((o) => String(o) === String(value)) ?? (d.default as string | number),
      help = d.optionHelp ? tx(d.optionHelp(cur)) : d.help ? tx(d.help) : undefined;
    return frame({
      label: tx(d.label),
      help,
      children: (
        <Seg
          size="sm"
          fit={fit}
          value={String(cur)}
          onChange={(v) => put(opts.find((o) => String(o) === v))}
          options={opts.map((o) => [String(o), name(o)])}
        />
      ),
    });
  }
  return null;
}
