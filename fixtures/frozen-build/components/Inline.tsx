'use client';

// #13: the bundler co-bundled this one into a framework chunk, so the manifest
// gives it no chunk of its own. Its cost is real but not separable — the report
// must say so rather than bill it at 0 B.
export function Inline({ note }: { note: string }) {
  return <em>{note}</em>;
}
