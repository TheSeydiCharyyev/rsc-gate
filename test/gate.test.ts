import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { strictGate } from '../src/gate.js';

const gate = (name: string) => strictGate(analyzeProject(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));

describe('--strict fails on server-only leaks', () => {
  // Until this change, every one of these exited 0: the report said the import
  // "will throw at build/runtime" and the CI gate went green anyway.
  it.each([
    'orphan-leak',
    'ns-reexport',
    'extends-alias',
    'exact-alias',
    'dynamic-import',
    'client-entry',
    'commonjs',
    'baseurl-bare',
  ])('fails on %s', (fixture) => {
    const g = gate(fixture);
    expect(g.serverOnlyLeaks).toBeGreaterThan(0);
    expect(g.failed).toBe(true);
  });
});

describe('--strict still fails on serialization hazards', () => {
  it('fails on demo, which has a hazard and no leak', () => {
    const g = gate('demo');
    expect(g.serializationHazards).toBeGreaterThan(0);
    expect(g.serverOnlyLeaks).toBe(0);
    expect(g.failed).toBe(true);
  });

  it('fails on serialize, which has both', () => {
    const g = gate('serialize');
    expect(g.serializationHazards).toBe(6);
    expect(g.serverOnlyLeaks).toBe(1);
    expect(g.failed).toBe(true);
  });
});

describe('--strict passes clean projects', () => {
  // The other half of a gate: it must not fire on code that is fine, or it is
  // just noise people learn to skip.
  it.each(['edge', 'action-ref', 'wildcard-leak', 'frozen-build', 'broken-tsconfig'])(
    'passes %s',
    (fixture) => {
      const g = gate(fixture);
      expect(g.serializationHazards).toBe(0);
      expect(g.serverOnlyLeaks).toBe(0);
      expect(g.failed).toBe(false);
    },
  );

  it('never fails on a spread prop alone — "cannot verify" is not a failure', () => {
    const a = analyzeProject(fileURLToPath(new URL('../fixtures/demo', import.meta.url)));
    const spreadOnly = { ...a, propFindings: a.propFindings.filter((f) => f.kind === 'spread'), serverOnlyViolations: [] };
    expect(strictGate(spreadOnly).failed).toBe(false);
  });
});
