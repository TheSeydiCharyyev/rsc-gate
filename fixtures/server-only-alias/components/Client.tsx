'use client';

// Reads like a leak, and used to be reported as one — but the specifier resolves
// to the local shim, not the package. Flagging it fails a build that is fine, and
// contradicts our own module list, which shows the shim as an ordinary module.
import 'server-only';

export function Client() {
  return <div />;
}
