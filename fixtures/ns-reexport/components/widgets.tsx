'use client';

// Reached only through `export * as widgets` — the leak is real and must be
// flagged, which requires the BFS to follow the namespace re-export.
import 'server-only';

export function Widget() {
  return null;
}
