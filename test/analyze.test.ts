import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url));
const a = analyzeProject(demo);
const byFile = Object.fromEntries(a.modules.map((m) => [m.file, m]));

describe('boundary detection', () => {
  it('finds the "use client" modules', () => {
    expect(byFile['components/ProductList.tsx'].directive).toBe('use client');
    expect(byFile['components/ui/Button.tsx'].directive).toBe('use client');
  });

  it('reports exactly one server→client boundary (page → ProductList)', () => {
    expect(a.boundaries).toHaveLength(1);
    const b = a.boundaries[0];
    expect(b.chain.at(-1)).toBe('components/ProductList.tsx');
    expect(b.chain[0]).toBe('app/page.tsx');
    expect(b.names).toContain('ProductList');
  });

  it('keeps entries and Header on the server', () => {
    expect(byFile['app/page.tsx'].envs).toEqual(['server']);
    expect(byFile['app/layout.tsx'].envs).toEqual(['server']);
    expect(byFile['components/Header.tsx'].envs).toEqual(['server']);
  });
});

describe('named-import tracking through barrels (ADR-001 finding 3)', () => {
  it('does NOT mark Card as client: only Button is requested from the barrel by client code', () => {
    expect(byFile['components/ui/Card.tsx'].envs).toEqual(['server']);
  });

  it('Button reached via barrel stays a client module without a false server env', () => {
    expect(byFile['components/ui/Button.tsx'].envs).toEqual(['client']);
  });

  it('the barrel itself is evaluated in both environments', () => {
    expect(byFile['components/ui/index.ts'].envs).toEqual(['client', 'server']);
  });
});

describe('why-chains', () => {
  it('explains why format.ts is client-bundled', () => {
    const m = byFile['utils/format.ts'];
    expect(m.envs).toEqual(['client']);
    expect(m.clientChain).toEqual(['app/page.tsx', 'components/ProductList.tsx', 'utils/format.ts']);
  });
});
