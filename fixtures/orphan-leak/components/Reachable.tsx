'use client';

// Reachable from the page — this leak is real and must be flagged.
import 'server-only';

export function Reachable() {
  return null;
}
