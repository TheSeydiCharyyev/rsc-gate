'use client';

import { useState } from 'react';

export default function AddToCart({ sku, quantity }: { sku: string; quantity: number }) {
  const [added, setAdded] = useState(false);

  return (
    <button onClick={() => setAdded(true)} disabled={added}>
      {added ? 'Added' : `Add ${quantity} × ${sku}`}
    </button>
  );
}
