'use client';

// Imported ONLY under webpackIgnore — the bundler ships nothing, so this
// must never enter the graph and its server-only import must stay silent.
import 'server-only';

export default function Ignored() {
  return null;
}
