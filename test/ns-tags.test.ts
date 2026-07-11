import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { strictGate } from '../src/gate.js';

const fx = (name: string) => analyzeProject(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

// A namespaced tag's name is a property access, not an identifier, so it matched
// nothing: the boundary was found, but the props behind it were never checked.
describe('<UI.Button> — a namespace import', () => {
  const a = fx('ns-tags');

  it('is recognized as crossing the boundary', () => {
    const crossing = a.propsCrossings.find((c) => c.component === 'UI.Button');
    expect(crossing).toBeDefined();
    expect(crossing!.componentFile).toBe('ui/Button.tsx');
  });

  it('has its props checked', () => {
    const finding = a.propFindings.find((f) => f.component === 'UI.Button');
    expect(finding?.prop).toBe('onClick');
    expect(finding?.kind).toBe('function');
    expect(strictGate(a).failed).toBe(true);
  });

  it('leaves a server component behind the same namespace alone', () => {
    // <UI.ServerCard render={fn} /> crosses nothing — flagging it would be a false
    // positive, and the tag being namespaced changes nothing about that.
    expect(a.propFindings.some((f) => f.component === 'UI.ServerCard')).toBe(false);
    expect(a.propsCrossings.map((c) => c.component)).not.toContain('UI.ServerCard');
  });
});

// The other shape: a barrel does `export * as widgets from './widgets'` and the
// importer binds `widgets` by name — the local is a namespace object, not a value.
describe('<widgets.Widget> — a namespace re-export', () => {
  const a = fx('ns-reexport');

  it('has its props checked too', () => {
    const props = a.propFindings
      .filter((f) => f.component === 'widgets.Widget')
      .map((f) => `${f.prop}:${f.kind}`)
      .sort();
    expect(props).toEqual(['onPick:function', 'thing:class-instance']);
  });

  it('still reports the leak behind the namespace (no regression)', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/widgets.tsx']);
  });
});
