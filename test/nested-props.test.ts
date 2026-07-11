import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const a = analyzeProject(fileURLToPath(new URL('../fixtures/nested-props', import.meta.url)));
const verdict = (prop: string) => a.propFindings.find((f) => f.prop === prop)?.kind ?? 'ok';

describe('a hazard buried inside a prop is still a hazard', () => {
  // React serializes a prop by walking into it, so `{ onPick: () => {} }` throws at
  // prerender exactly like `onPick={() => {}}`. Only the top level was inspected,
  // so every one of these read as `ok` and --strict passed the project green.
  it.each([
    ['inObject', 'function'],
    ['inArray', 'function'],
    ['inTernary', 'function'],
    ['deepNested', 'function'],
    ['methodShorthand', 'function'],
    ['viaOr', 'function'],
    ['nestedClassInstance', 'class-instance'],
  ])('%s → %s', (prop, kind) => {
    expect(verdict(prop)).toBe(kind);
  });
});

describe('an imported function is the same hazard as a local one', () => {
  it.each([
    ['importedFn', 'function-ref'],
    ['importedArrow', 'function-ref'],
  ])('%s → %s', (prop, kind) => {
    expect(verdict(prop)).toBe(kind);
  });
});

describe('what must NOT be flagged', () => {
  // The other half of the job. Each of these is legal, and flagging it would be a
  // false positive — the one thing this project refuses to emit.
  it('a Server Action, bare or nested in an object', () => {
    expect(verdict('action')).toBe('ok');
    expect(verdict('actionInObject')).toBe('ok');
  });

  it('a client component passed as a prop — React serializes client references', () => {
    expect(verdict('clientRef')).toBe('ok');
  });

  it('imported values that are not functions', () => {
    expect(verdict('plainObject')).toBe('ok');
    expect(verdict('plainString')).toBe('ok');
  });

  it('an opaque value — a call result is not knowable, so it is not guessed at', () => {
    expect(verdict('fromCall')).toBe('ok');
  });

  it('serializable data, however nested', () => {
    expect(verdict('serializable')).toBe('ok');
  });
});

describe('the gate', () => {
  it('fails the project', () => {
    expect(a.propFindings.filter((f) => f.kind !== 'spread').length).toBe(9);
  });
});
