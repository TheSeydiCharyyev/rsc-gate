'use client';

import 'server-only';

// Nothing renders this any more — the admin route was removed. It still sits in
// the tree, still says "use client", and still imports "server-only".
export default function AdminPanel({ margin }: { margin: number }) {
  return <p>margin: {margin}</p>;
}
