import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { strictGate } from '../src/gate.js';
import { renderReport } from '../src/report.js';

const fx = (name: string) => analyzeProject(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

describe('lazy edges are visible in the output', () => {
  const a = fx('dynamic-import');

  it('marks a boundary reached through next/dynamic or React.lazy', () => {
    // ImportEntry.dynamic was written and never read: a code-split subtree looked
    // exactly like one that ships with the first load.
    const chart = a.boundaries.find((b) => b.chain.at(-1) === 'components/Chart.tsx')!;
    const panel = a.boundaries.find((b) => b.chain.at(-1) === 'components/Panel.tsx')!;
    expect(chart.lazy).toBe(true);
    expect(panel.lazy).toBe(true);
  });

  it('says so in the report', () => {
    const text = renderReport(a, { color: false, version: '0.0.0', build: null });
    expect(text).toMatch(/components\/Chart\.tsx \[lazy\]/);
  });

  it('does not mark an eager boundary as lazy', () => {
    // A statically imported client component is not code-split — claiming it is
    // would misreport when the code actually ships.
    const eager = fx('serialize').boundaries;
    expect(eager.every((b) => b.lazy === undefined)).toBe(true);
    const text = renderReport(fx('serialize'), { color: false, version: '0.0.0', build: null });
    expect(text).not.toContain('[lazy]');
  });
});

describe('an unreached "use client" module importing server-only gets a note', () => {
  const a = fx('orphan-leak');

  it('is a note, not a leak', () => {
    // A directive alone ships nothing (FP #12), so failing on it would be a false
    // positive. But silence throws away a real signal: either it is dead code, or
    // the graph is missing an edge and the leak is real but unseen.
    const note = a.notes.find((n) => n.file === 'components/Orphan.tsx');
    expect(note?.kind).toBe('unreached-server-only');
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).not.toContain('components/Orphan.tsx');
  });

  it('never gates a build', () => {
    // orphan-leak fails --strict because of a *real* leak elsewhere in it. The
    // note itself must carry no weight at all.
    const noteOnly = { ...a, serverOnlyViolations: [], propFindings: [] };
    expect(noteOnly.notes.length).toBeGreaterThan(0);
    expect(strictGate(noteOnly).failed).toBe(false);
  });

  it('appears in the report, marked as not a failure', () => {
    const text = renderReport(a, { color: false, version: '0.0.0', build: null });
    expect(text).toContain('NOTES');
    expect(text).toContain('nothing here fails --strict');
    expect(text).toMatch(/Orphan\.tsx/);
  });

  it('is not raised for a module the graph does reach', () => {
    expect(a.notes.some((n) => n.file === 'components/Reachable.tsx')).toBe(false);
  });

  it('is not raised when the specifier is an aliased shim', () => {
    // The shim resolves locally and throws nothing — neither a leak nor a note.
    const shim = fx('server-only-alias');
    expect(shim.notes).toEqual([]);
    expect(shim.serverOnlyViolations).toEqual([]);
  });
});
