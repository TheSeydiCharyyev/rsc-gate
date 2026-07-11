import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { strictGate } from '../src/gate.js';

const fx = fileURLToPath(new URL('../fixtures/serialize', import.meta.url));
const a = analyzeProject(fx);
const crossing = a.propsCrossings.find((c) => c.component === 'Client');
const verdictOf = (name: string) => crossing?.props.find((p) => p.name === name)?.verdict;

describe('serialization detectors (Ф3.1)', () => {
  it('flags exactly six hazards: five class instances and a symbol', () => {
    const hazards = a.propFindings.filter((f) => f.kind !== 'spread');
    expect(hazards).toHaveLength(6);
    expect(hazards.map((f) => f.kind).sort()).toEqual([
      'class-instance',
      'class-instance',
      'class-instance',
      'class-instance',
      'class-instance',
      'symbol',
    ]);
  });

  it('flags new Thing() as class-instance', () => {
    expect(verdictOf('thing')).toBe('class-instance');
  });

  it('flags Symbol() as symbol', () => {
    expect(verdictOf('sym')).toBe('symbol');
  });

  it('does NOT flag React 19 serializable built-ins (Date, Map)', () => {
    expect(verdictOf('when')).toBe('ok');
    expect(verdictOf('lookup')).toBe('ok');
  });

  it('does NOT flag primitives or plain objects', () => {
    expect(verdictOf('label')).toBe('ok');
    expect(verdictOf('count')).toBe('ok');
    expect(verdictOf('config')).toBe('ok');
  });

  // Regression: SERIALIZABLE_CTORS must match ReactFlightServer renderModelDestructive
  // (react v19.0.0) — binary flight types were flagged as class-instance before.
  it('does NOT flag binary-flight built-ins (ArrayBuffer, TypedArray, DataView, FormData, Blob)', () => {
    expect(verdictOf('buf')).toBe('ok');
    expect(verdictOf('bytes')).toBe('ok');
    expect(verdictOf('view')).toBe('ok');
    expect(verdictOf('form')).toBe('ok');
    expect(verdictOf('blob')).toBe('ok');
  });

  it('does NOT flag new Error() — Flight serializes it (redacted in prod, build passes)', () => {
    expect(verdictOf('err')).toBe('ok');
  });

  // Regression: these were wrongly whitelisted — Flight throws on them at render.
  it('flags RegExp, WeakMap and WeakSet as class-instance (React does NOT serialize them)', () => {
    expect(verdictOf('pattern')).toBe('class-instance');
    expect(verdictOf('weak')).toBe('class-instance');
    expect(verdictOf('wset')).toBe('class-instance');
  });

  it('flags new URL() as class-instance (negative case — must stay flagged)', () => {
    expect(verdictOf('url')).toBe('class-instance');
  });
});

// Flight does not reject symbols, it rejects symbols it cannot name: it throws only
// when `Symbol.for(name) !== value` (ReactFlightServer.js, react v19.0.0). A symbol
// from the global registry crosses; an unregistered `Symbol('x')` does not. We flagged
// both, so `Symbol.for(...)` failed --strict on a project React is perfectly happy with.
describe('global symbols cross the boundary (false positive, fixed in 0.3.1)', () => {
  it('does NOT flag Symbol.for() — the global registry round-trips through the key', () => {
    expect(verdictOf('kind')).toBe('ok');
  });

  it('still flags bare Symbol() — unregistered, and Flight throws on it', () => {
    expect(verdictOf('sym')).toBe('symbol');
  });

  // The direction 0.2.0 never asserted: a healthy project must not fail the gate.
  it('leaves --strict green on a project whose only symbol is a global one', () => {
    const healthy = analyzeProject(fileURLToPath(new URL('../fixtures/symbol-global', import.meta.url)));
    expect(healthy.propFindings.filter((f) => f.kind !== 'spread')).toEqual([]);
    expect(strictGate(healthy).failed).toBe(false);
  });
});
