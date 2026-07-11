import dynamic from 'next/dynamic';

import AddToCart from '@/components/AddToCart';
import ProductGrid from '@/components/ProductGrid';
import Rating from '@/components/Rating';
import { Money } from '@/lib/money';

const PriceChart = dynamic(() => import('@/components/PriceChart'));

const products = [
  { id: 'sku-1', name: 'Wool coat', cents: 24900 },
  { id: 'sku-2', name: 'Linen shirt', cents: 8900 },
];

export default function Page() {
  return (
    <main>
      <ProductGrid products={products} onSelect={(id: string) => track(id)} />
      <PriceChart total={new Money(33800)} onZoom={() => {}} />
      <AddToCart sku="sku-1" quantity={1} />
      <Rating value={4.5} />
    </main>
  );
}

function track(id: string) {
  console.log(id);
}
