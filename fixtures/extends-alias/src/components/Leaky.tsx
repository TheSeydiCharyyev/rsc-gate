'use client';

// Reached ONLY through the "@/*" alias declared in tsconfig.base.json —
// resolving it requires merging the "extends" chain (FP #9).
import 'server-only';

export function Leaky() {
  return null;
}
