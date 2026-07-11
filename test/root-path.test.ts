import { describe, expect, it } from 'vitest';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { strictGate } from '../src/gate.js';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** The same project, named the way a caller would name it from the repo root. */
const asRelative = (name: string) => relative(process.cwd(), resolve(repo, 'fixtures', name)).replaceAll('\\', '/');

describe('a relative root analyzes the same project as an absolute one', () => {
  // The bug: listSourceFiles walks with join(root, …), so the node map inherited
  // the root's shape, while the resolver always returns absolute paths. Every
  // nodes.get(target) missed, every edge was dropped, and the graph collapsed to
  // the entries — an empty report that reads as "all clean".
  it.each(['orphan-leak', 'commonjs', 'baseurl-bare', 'serialize', 'edge', 'demo'])(
    'agrees with itself on %s',
    (name) => {
      const abs = analyzeProject(resolve(repo, 'fixtures', name));
      const rel = analyzeProject(asRelative(name));

      // Everything but `root` must be identical — same modules, same boundaries,
      // same leaks, same findings.
      expect({ ...rel, root: null }).toEqual({ ...abs, root: null });
      // …and `root` itself is normalized, so the two agree on that too.
      expect(rel.root).toBe(abs.root);
    },
  );
});

describe('leaks do not disappear when the caller passes a relative path', () => {
  it.each(['orphan-leak', 'commonjs', 'baseurl-bare'])('still reports the leak in %s', (name) => {
    const a = analyzeProject(asRelative(name));
    expect(a.serverOnlyViolations).toHaveLength(1);
    expect(a.modules.length).toBeGreaterThan(1); // not just the entry file
  });

  it('does not hand a green --strict gate to a leaking project', () => {
    // The worst consequence: the CI gate we ship would pass a project that leaks.
    expect(strictGate(analyzeProject(asRelative('orphan-leak'))).failed).toBe(true);
    expect(strictGate(analyzeProject(asRelative('serialize'))).failed).toBe(true);
  });
});

describe('root is normalized regardless of how it is spelled', () => {
  const expected = resolve(repo, 'fixtures', 'edge');

  it.each([
    ['plain relative', asRelative('edge')],
    ['dot-prefixed', './' + asRelative('edge')],
    ['trailing slash', asRelative('edge') + '/'],
    ['round trip through ..', asRelative('edge') + '/../edge'],
    ['already absolute', expected],
  ])('%s', (_label, input) => {
    const a = analyzeProject(input);
    expect(a.root).toBe(expected);
    expect(a.boundaries).toHaveLength(2);
  });
});
