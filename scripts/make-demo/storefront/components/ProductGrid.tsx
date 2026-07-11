'use client';

import { formatPrice } from '@/lib/format';

type Product = { id: string; name: string; cents: number };

export default function ProductGrid({
  products,
  onSelect,
}: {
  products: Product[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul>
      {products.map((p) => (
        <li key={p.id} onClick={() => onSelect(p.id)}>
          {p.name} — {formatPrice(p.cents)}
        </li>
      ))}
    </ul>
  );
}
