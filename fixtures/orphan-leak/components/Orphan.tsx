'use client';

// Imported by nobody: never ships to the client, so its server-only import
// must NOT be reported as a leak (regression for FP #12).
import 'server-only';

export function Orphan() {
  return null;
}
