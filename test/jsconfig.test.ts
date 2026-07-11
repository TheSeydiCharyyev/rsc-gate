import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { createResolver } from '../src/resolve.js';

const fixture = fileURLToPath(new URL('../fixtures/jsconfig', import.meta.url));

describe('a JS project configures its aliases in jsconfig.json', () => {
  const a = analyzeProject(fixture);
  const files = a.modules.map((m) => m.file);

  it('resolves them, instead of returning an empty report', () => {
    // Reading only tsconfig.json dropped every alias here: the graph collapsed to
    // app/page.jsx alone and the report read as "all clean".
    expect(files).toEqual(['app/page.jsx', 'components/Leaky.jsx', 'components/Plain.jsx']);
    expect(a.boundaries).toHaveLength(2);
  });

  it('finds the leak that was invisible', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/Leaky.jsx']);
  });

  it('checks props across the boundary too', () => {
    const fn = a.propFindings.find((f) => f.prop === 'onPick');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
  });
});

// Both configs present is not hypothetical — a project mid-migration has both.
// Next and tsc treat it as a TypeScript project and ignore jsconfig; so do we.
const root = mkdtempSync(join(tmpdir(), 'rsc-gate-jsconfig-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, 'app'), { recursive: true });
mkdirSync(join(root, 'ts'), { recursive: true });
mkdirSync(join(root, 'js'), { recursive: true });
writeFileSync(join(root, 'app', 'page.tsx'), 'export default function Page() {\n  return <div />;\n}\n');
writeFileSync(join(root, 'ts', 'Target.tsx'), 'export const Target = 1;\n');
writeFileSync(join(root, 'js', 'Target.jsx'), 'export const Target = 1;\n');
writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./ts/*"] } } }\n');
writeFileSync(join(root, 'jsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./js/*"] } } }\n');

describe('tsconfig.json wins when both configs exist', () => {
  it('follows tsconfig, not jsconfig', () => {
    const hit = createResolver(root).resolve(join(root, 'app', 'page.tsx'), '@/Target');
    expect(hit).toBe(join(root, 'ts', 'Target.tsx'));
    expect(hit).not.toContain(`${join('js', 'Target')}`);
  });
});
