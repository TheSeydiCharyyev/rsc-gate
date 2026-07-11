'use client';

// Lazily loaded via next/dynamic(() => import(...)) — ships to the client,
// so this leak is real and must be flagged.
import 'server-only';

export default function Chart({ onSelect, thing }: { onSelect: () => void; thing: unknown }) {
  return (
    <button onClick={onSelect}>{String(thing)}</button>
  );
}
