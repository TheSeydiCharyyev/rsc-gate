'use client';

import { priceHistory } from '@/lib/pricing';

export default function PriceChart({
  total,
  onZoom,
}: {
  total: { cents: number };
  onZoom: () => void;
}) {
  const points = priceHistory('sku-1');

  return (
    <figure onDoubleClick={onZoom}>
      <figcaption>{total.cents}</figcaption>
      <svg viewBox="0 0 120 40">
        {points.map((p, i) => (
          <rect key={i} x={i * 12} y={40 - p / 8} width="8" height={p / 8} />
        ))}
      </svg>
    </figure>
  );
}
