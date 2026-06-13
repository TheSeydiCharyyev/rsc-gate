'use client';

// Client component importing a server-only package — Ф3.3 case.
import 'server-only';

export function Leaky() {
  return null;
}
