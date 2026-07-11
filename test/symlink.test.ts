import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeProject } from '../src/analyze.js';

// Symlinks cannot be committed portably, so the tree is built here. On Windows a
// 'junction' needs no elevation; on Linux the type argument is ignored and a plain
// symlink is created — so this runs on both CI platforms.
const root = mkdtempSync(join(tmpdir(), 'rsc-gate-symlink-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, 'app'), { recursive: true });
mkdirSync(join(root, 'components'), { recursive: true });
mkdirSync(join(root, 'shared'), { recursive: true });
writeFileSync(join(root, 'tsconfig.json'), '{}\n');
writeFileSync(
  join(root, 'app', 'page.tsx'),
  `import { Leaky } from '../components/Leaky';\nimport { Shared } from '../linked/Shared';\n\nexport default function Page() {\n  return (\n    <main>\n      <Leaky />\n      <Shared />\n    </main>\n  );\n}\n`,
);
writeFileSync(join(root, 'components', 'Leaky.tsx'), `'use client';\nimport 'server-only';\n\nexport function Leaky() {\n  return <div />;\n}\n`);
writeFileSync(join(root, 'shared', 'Shared.tsx'), `'use client';\n\nexport function Shared() {\n  return <span />;\n}\n`);

// A cycle: components/self points back at the project root.
symlinkSync(root, join(root, 'components', 'self'), 'junction');
// A linked source directory, the monorepo pattern — real modules live behind it.
symlinkSync(join(root, 'shared'), join(root, 'linked'), 'junction');
// A link to nowhere.
symlinkSync(join(root, 'does-not-exist'), join(root, 'dangling'), 'junction');

describe('symlinks in the project tree', () => {
  const a = analyzeProject(root);
  const files = a.modules.map((m) => m.file);

  it('does not die on a cycle', () => {
    // The old walk recursed through components/self/components/self/… until the
    // OS refused with ELOOP, and the analysis crashed instead of reporting.
    expect(a.modules.length).toBeGreaterThan(0);
    expect(files).toContain('app/page.tsx');
  });

  it('still analyzes what the cycle was hiding', () => {
    expect(files).toContain('components/Leaky.tsx');
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/Leaky.tsx']);
  });

  it('follows a linked source directory, as the bundler does', () => {
    // Skipping links instead of de-duplicating them would drop these modules —
    // a silent false negative in exactly the monorepos that use them.
    expect(files).toContain('linked/Shared.tsx');
    expect(a.boundaries.map((b) => b.chain[b.chain.length - 1])).toContain('linked/Shared.tsx');
  });

  it('reaches each file once, not once per path that leads to it', () => {
    expect(new Set(files).size).toBe(files.length);
    // shared/ is reachable directly and through linked/; it must not be both.
    const shared = files.filter((f) => f.endsWith('Shared.tsx'));
    expect(shared).toHaveLength(1);
  });

  it('ignores a dangling link instead of throwing', () => {
    expect(files.some((f) => f.includes('dangling'))).toBe(false);
    expect(() => analyzeProject(root)).not.toThrow();
  });
});
