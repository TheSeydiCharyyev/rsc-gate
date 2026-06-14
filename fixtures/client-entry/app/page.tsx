'use client';

// A client page that also imports server-only code: the leak must be detected,
// which only happens if the entry is treated as client (regression for FP #3).
import 'server-only';

export default function Page() {
  return null;
}
