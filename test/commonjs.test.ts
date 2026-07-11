import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { parseModule } from '../src/parse.js';

const fixture = fileURLToPath(new URL('../fixtures/commonjs', import.meta.url));
const a = analyzeProject(fixture);
const file = (f: string) => a.modules.find((m) => m.file === f);

describe('require() is an edge (#11)', () => {
  it('reaches a .cjs required from a client module', () => {
    // Before: require() created no edge, so the file was not in the graph at all
    // — not "opaque", simply absent, and the report read as all clean.
    const secrets = file('lib/secrets.cjs');
    expect(secrets).toBeDefined();
    expect(secrets!.envs).toContain('client');
  });

  it('catches the server-only leak inside it', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['lib/secrets.cjs']);
    expect(a.serverOnlyViolations[0].imports).toBe('server-only');
  });

  it('explains how the leak is reachable', () => {
    expect(file('lib/secrets.cjs')!.clientChain).toEqual([
      'app/page.tsx',
      'lib/Widget.tsx',
      'lib/secrets.cjs',
    ]);
  });

  it('marks it opaque rather than passing it off as analyzed', () => {
    expect(file('lib/secrets.cjs')!.opaqueExports).toBe(true);
    // A file with real ESM exports is not opaque.
    expect(file('lib/Widget.tsx')!.opaqueExports).toBeUndefined();
  });
});

describe('require() edges are not invented (#11 negatives)', () => {
  // ghost.cjs exists on disk and imports "server-only". Nothing may reach it —
  // if any negative below starts resolving, it surfaces here and these fail.
  it('never reaches ghost.cjs through require(variable), require.resolve, or obj.require', () => {
    expect(file('lib/ghost.cjs')).toBeUndefined();
    expect(a.modules.map((m) => m.file)).not.toContain('lib/ghost.cjs');
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).not.toContain('lib/ghost.cjs');
    expect(JSON.stringify(a)).not.toContain('ghost');
  });

  it('parses exactly one require edge out of the client module', () => {
    const parsed = parseModule(fileURLToPath(new URL('../fixtures/commonjs/lib/Widget.tsx', import.meta.url)));
    const cjs = parsed.imports.filter((i) => i.commonjs);
    expect(cjs).toHaveLength(1);
    expect(cjs[0].specifier).toBe('./secrets.cjs');
    // It pulls the whole module — CommonJS has no named-binding semantics here.
    expect(cjs[0].namespace).toBe(true);
    expect(parsed.imports.some((i) => i.specifier === './ghost.cjs')).toBe(false);
  });
});

describe('CommonJS export detection', () => {
  const parse = (name: string) =>
    parseModule(fileURLToPath(new URL(`../fixtures/commonjs/lib/${name}`, import.meta.url)));

  it('flags module.exports = …', () => {
    expect(parse('secrets.cjs').commonjsExports).toBe(true);
  });

  it('does not flag a module with only ESM exports', () => {
    expect(parse('Widget.tsx').commonjsExports).toBeUndefined();
  });
});
