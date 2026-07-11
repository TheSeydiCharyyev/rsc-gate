import { ProductCard } from '../../../components/ProductCard';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductCard id={id} />;
}
