import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 0.3.0 nearly shipped with `AnalysisNote` missing from the barrel: the type was
// added to analyze.ts and never re-exported, so a consumer could read
// `analysis.notes` but not name its type. The consumer smoke test caught it — this
// makes the check part of `npm test`, where it is cheap and always runs.
const read = (file: string) => readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');

const declaredTypes = (source: string) =>
  [...source.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]);

describe('every public type reaches the package barrel', () => {
  const barrel = read('index.ts');

  it.each(['analyze.ts', 'buildinfo.ts', 'parse.ts', 'props.ts', 'gate.ts', 'explain.ts'])(
    'src/%s',
    (file) => {
      const missing = declaredTypes(read(file)).filter((name) => !new RegExp(`\\b${name}\\b`).test(barrel));
      expect(missing).toEqual([]);
    },
  );
});
