import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { strictGate } from '../src/gate.js';

const fx = (name: string) => analyzeProject(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

describe('"server-only" aliased to a local shim is not a leak', () => {
  const a = fx('server-only-alias');

  it('does not report a leak', () => {
    // The check matched the raw specifier, before resolution. With
    // `"server-only": ["./lib/shim"]` in paths, the import resolves to a harmless
    // local module and nothing throws at build — but it was flagged anyway.
    expect(a.serverOnlyViolations).toEqual([]);
  });

  it('does not fail a healthy build', () => {
    expect(strictGate(a).failed).toBe(false);
  });

  it('and the report no longer contradicts its own module list', () => {
    // The graph resolved the specifier to the shim and listed it as an ordinary
    // client-bundled module, while the leak section insisted the import "will
    // throw at build/runtime". Both cannot be true.
    expect(a.modules.map((m) => m.file)).toContain('lib/shim.ts');
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).not.toContain('components/Client.tsx');
  });
});

describe('a real "server-only" import is still a leak', () => {
  // The other half: the fix must not silence the detector it is narrowing.
  it.each(['orphan-leak', 'commonjs', 'baseurl-bare', 'serialize', 'jsconfig', 'ns-reexport'])(
    '%s still reports its leak',
    (name) => {
      const a = fx(name);
      expect(a.serverOnlyViolations).toHaveLength(1);
      expect(strictGate(a).failed).toBe(true);
    },
  );
});
