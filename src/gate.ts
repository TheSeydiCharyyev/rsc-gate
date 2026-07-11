import type { Analysis } from './analyze.js';

export interface GateResult {
  /** CI should fail: exit code 2. */
  failed: boolean;
  /** Props that will not survive the server→client boundary. */
  serializationHazards: number;
  /** server-only code reachable from the client bundle. */
  serverOnlyLeaks: number;
}

/**
 * What `--strict` fails on. A predicate rather than a branch inside cli.ts, so the
 * gate can be tested without spawning a build — and so an API consumer can apply
 * exactly the same rule.
 *
 * Spread props are excluded: `{...props}` cannot be checked statically, and
 * failing a build on "cannot verify" would be a false positive.
 */
export function strictGate(analysis: Analysis): GateResult {
  const serializationHazards = analysis.propFindings.filter((f) => f.kind !== 'spread').length;
  const serverOnlyLeaks = analysis.serverOnlyViolations.length;
  return {
    failed: serializationHazards > 0 || serverOnlyLeaks > 0,
    serializationHazards,
    serverOnlyLeaks,
  };
}
