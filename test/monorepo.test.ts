import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { createResolver } from '../src/resolve.js';
import { strictGate } from '../src/gate.js';

const fixture = fileURLToPath(new URL('../fixtures/monorepo', import.meta.url));

describe('a workspace package resolves through its package.json', () => {
  const a = analyzeProject(fixture);
  const files = a.modules.map((m) => m.file);

  it('follows an "exports" map', () => {
    // Without it the package resolved to nothing: the component inside it, the
    // boundary it forms and the leak it carries were all invisible.
    expect(files).toContain('packages/ui/src/index.tsx');
    expect(files).toContain('packages/ui/src/Button.tsx');
    expect(a.boundaries).toHaveLength(1);
  });

  it('still honours a plain "main" when there is no exports map', () => {
    expect(files).toContain('packages/util/index.ts');
  });

  it('finds the leak inside the package', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['packages/ui/src/Button.tsx']);
  });

  it('checks props handed to a component that lives in the package', () => {
    const finding = a.propFindings.find((f) => f.prop === 'onClick');
    expect(finding?.componentFile).toBe('packages/ui/src/Button.tsx');
    expect(finding?.kind).toBe('function');
    expect(strictGate(a).failed).toBe(true);
  });
});

// The other half: the bare specifier `@acme/ui`, resolved through the node_modules
// symlink a package manager creates for a workspace. Symlinks cannot be committed,
// so the tree is built here; 'junction' works unelevated on Windows and is ignored
// on Linux, so this runs on both CI platforms.
const root = mkdtempSync(join(tmpdir(), 'rsc-gate-workspace-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, 'app'), { recursive: true });
mkdirSync(join(root, 'packages', 'ui', 'src'), { recursive: true });
mkdirSync(join(root, 'node_modules', '@acme'), { recursive: true });
mkdirSync(join(root, 'node_modules', 'lodash'), { recursive: true });

writeFileSync(join(root, 'tsconfig.json'), '{}\n');
writeFileSync(
  join(root, 'app', 'page.tsx'),
  `import { Button } from '@acme/ui';\nimport { chunk } from 'lodash';\n\nexport default function Page() {\n  return <Button onClick={() => chunk([1])} />;\n}\n`,
);
writeFileSync(
  join(root, 'packages', 'ui', 'package.json'),
  '{ "name": "@acme/ui", "exports": { ".": "./src/index.tsx" } }\n',
);
writeFileSync(join(root, 'packages', 'ui', 'src', 'index.tsx'), "export { Button } from './Button';\n");
writeFileSync(
  join(root, 'packages', 'ui', 'src', 'Button.tsx'),
  `'use client';\nimport 'server-only';\n\nexport function Button({ onClick }: { onClick: () => void }) {\n  return <button onClick={onClick} />;\n}\n`,
);

// A real third-party package, physically inside the project's node_modules.
writeFileSync(join(root, 'node_modules', 'lodash', 'package.json'), '{ "name": "lodash", "main": "./index.js" }\n');
writeFileSync(join(root, 'node_modules', 'lodash', 'index.js'), 'export function chunk(a) {\n  return a;\n}\n');

// The workspace link a package manager would create.
symlinkSync(join(root, 'packages', 'ui'), join(root, 'node_modules', '@acme', 'ui'), 'junction');

describe('a bare workspace specifier, via the node_modules link', () => {
  const a = analyzeProject(root);
  const files = a.modules.map((m) => m.file);

  it('resolves to the real source in the repo, not the link', () => {
    expect(files).toContain('packages/ui/src/Button.tsx');
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['packages/ui/src/Button.tsx']);
  });

  it('leaves a genuine third-party package external', () => {
    // lodash lives under node_modules for real. It is inside the project directory,
    // which is why "inside the project" alone is not the test — we never analyze
    // node_modules, and pulling lodash into the graph would be nonsense.
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('lodash'))).toBe(false);
    expect(createResolver(root).resolve(join(root, 'app', 'page.tsx'), 'lodash')).toBeNull();
  });
});
