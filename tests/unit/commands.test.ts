// The command registry: what applies to a target, in which order, and that the interface's abilities decide.
import { describe, expect, it } from 'vitest';
import { applies, commandsFor, define, label, menuFor, run, setHost } from '../../src/app/commands/registry';

const ran: string[] = [];
define({
  id: 't.play',
  on: 'tracks',
  section: 'play',
  icon: 'play',
  label: () => 'Play',
  run: (t) => ran.push('play ' + t.ids.length),
});
define({
  id: 't.drop',
  on: 'tracks',
  section: 'remove',
  icon: 'trash',
  danger: true,
  label: () => 'Drop',
  run: () => ran.push('drop'),
});
define({
  id: 't.name',
  on: 'tracks',
  section: 'collect',
  icon: 'tag',
  label: (t) => `Name ${t.ids.length}`,
  when: (_t, h) => !!h.ask,
  sub: () => [{ label: 'one' }],
});
define({
  id: 'p.only',
  on: 'playlist',
  section: 'play',
  icon: 'play',
  label: () => 'P',
  when: (t) => t.ids.length > 0,
});
const some = { kind: 'tracks' as const, ids: ['a', 'b'] };

describe('commands', () => {
  it('a target gets its own commands, by section, a line between sections', () => {
    setHost({ ask: async () => 'x' });
    expect(commandsFor(some).map((c) => c.id)).toEqual(['t.play', 't.name', 't.drop']);
    const menu = menuFor(some);
    expect(menu.map((m) => (m === '-' ? '-' : m.label))).toEqual(['Play', '-', 'Name 2', '-', 'Drop']);
    expect(menu[2] !== '-' && menu[2].sub?.length).toBe(1);
    expect(menu[4] !== '-' && menu[4].danger).toBe(true);
    expect(commandsFor({ kind: 'playlist', id: 'p', name: 'P', ids: [] })).toEqual([]);
  });
  it('what the interface cannot do does not apply there', () => {
    setHost({});
    expect(applies('t.name', some)).toBe(false);
    expect(menuFor(some).map((m) => (m === '-' ? '-' : m.label))).toEqual(['Play', '-', 'Drop']);
  });
  it('runs by id; nothing happens where it does not apply', () => {
    run('t.play', some);
    run('p.only', { kind: 'playlist', id: 'p', name: 'P', ids: [] });
    run('t.drop', some);
    expect(ran).toEqual(['play 2', 'drop']);
    expect(label('t.name', some)).toBe('Name 2');
  });
  it('an id is defined once', () => {
    expect(() => define({ id: 't.play', on: 'tracks', section: 'play', icon: 'x', label: () => '' })).toThrow(/twice/);
  });
});
