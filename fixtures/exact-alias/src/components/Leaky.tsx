'use client';

// Reached ONLY through the exact alias "@/leaky" (no /* pattern) — the leak
// is real and must be flagged (FP #10: exact aliases were dropped).
import 'server-only';

export function Leaky(_props: { label: string }) {
  return null;
}
