// Must stay unreachable: 'dead/*' maps to ./nowhere/*, and a matched pattern is
// final. If we ever fell back to baseUrl, this file's server-only import would
// show up as a leak — which is what the test asserts must not happen.
'use client';
import 'server-only';

export function Ghost() {
  return <div>ghost</div>;
}
