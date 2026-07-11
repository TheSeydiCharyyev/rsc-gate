'use client';

// A real edge: without it the .cjs fell out of the graph entirely and its
// server-only import came back clean (#11).
const secrets = require('./secrets.cjs');

// Negatives — none of these may become an edge. Each points at ghost.cjs, which
// exists on disk and imports "server-only": if any of them wrongly resolved,
// ghost.cjs would surface as a leak below, and the tests would catch it.
const mod = process.env.MOD_NAME as string;
const notStatic = require(mod); // non-literal specifier — not knowable
const id = require.resolve('./ghost.cjs'); // an id, not a module
const loader = { require: (s: string) => s };
const notRequire = loader.require('./ghost.cjs'); // merely shares the name

export function Widget() {
  return (
    <div data-x={String(notStatic) + id + notRequire}>{secrets.token}</div>
  );
}
