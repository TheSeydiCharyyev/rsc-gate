import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeProject } from '../src/analyze.js';

// The BFS queue is as long as the widest fan-out in the graph — a barrel
// re-exporting hundreds of components makes it hundreds long. This guards the
// traversal itself: every module behind the barrel must still be reached, and the
// one leak hidden among them must still be found.
//
// Deliberately not a timing test: a wall-clock assertion in CI is a flake waiting
// to happen. The quadratic that `shift()` introduced is invisible below ~10k queue
// items anyway (measured); what matters here is that the walk stays correct.
const WIDTH = 200;

const root = mkdtempSync(join(tmpdir(), 'rsc-gate-wide-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, 'app'), { recursive: true });
mkdirSync(join(root, 'components'), { recursive: true });
writeFileSync(join(root, 'tsconfig.json'), '{}\n');

const names = Array.from({ length: WIDTH }, (_, i) => `C${i}`);
writeFileSync(
  join(root, 'components', 'barrel.ts'),
  names.map((n) => `export { ${n} } from './${n}';`).join('\n') + '\n',
);
for (const n of names) {
  // Exactly one of them leaks.
  const leak = n === 'C137' ? "import 'server-only';\n" : '';
  writeFileSync(
    join(root, 'components', `${n}.tsx`),
    `'use client';\n${leak}\nexport function ${n}() {\n  return <div />;\n}\n`,
  );
}
writeFileSync(
  join(root, 'app', 'page.tsx'),
  `import * as All from '../components/barrel';\n\nexport default function Page() {\n  return <div>{Object.keys(All).length}</div>;\n}\n`,
);

describe('a wide fan-out is walked completely', () => {
  const a = analyzeProject(root);

  it('reaches every module behind the barrel', () => {
    // barrel + page + WIDTH components
    expect(a.modules).toHaveLength(WIDTH + 2);
    expect(a.modules.filter((m) => m.directive === 'use client')).toHaveLength(WIDTH);
  });

  it('records a boundary for each of them', () => {
    expect(a.boundaries).toHaveLength(WIDTH);
  });

  it('still finds the single leak buried in the fan-out', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/C137.tsx']);
  });
});
