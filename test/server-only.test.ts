import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const serialize = fileURLToPath(new URL('../fixtures/serialize', import.meta.url));
const edge = fileURLToPath(new URL('../fixtures/edge', import.meta.url));
const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url));

describe('server-only leak detector (Ф3.3)', () => {
  it('flags a client component importing "server-only"', () => {
    const a = analyzeProject(serialize);
    expect(a.serverOnlyViolations).toHaveLength(1);
    const v = a.serverOnlyViolations[0];
    expect(v.clientFile).toBe('components/Leaky.tsx');
    expect(v.imports).toBe('server-only');
    expect(v.reason).toBe('server-only-package');
  });

  it('produces NO false positives on edge or demo fixtures', () => {
    expect(analyzeProject(edge).serverOnlyViolations).toHaveLength(0);
    expect(analyzeProject(demo).serverOnlyViolations).toHaveLength(0);
  });
});
