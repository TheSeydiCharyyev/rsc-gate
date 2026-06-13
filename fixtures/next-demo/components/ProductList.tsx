'use client';

import { useState } from 'react';
import { Button } from './ui';
import { formatPrice } from '../utils/format';

export function ProductList({ products, onSelect = () => {} }: { products: any[]; onSelect?: (id: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>
          {p.name} — {formatPrice(p.price)}
          <Button
            onClick={() => {
              setSelected(p.id);
              onSelect(p.id);
            }}
          >
            {selected === p.id ? 'Selected' : 'Select'}
          </Button>
        </li>
      ))}
    </ul>
  );
}
