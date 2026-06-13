import { Header } from '../components/Header';
import { ProductList } from '../components/ProductList';

export default function Page() {
  const products = [{ id: 1, name: 'Widget', price: 9.99 }];
  return (
    <main>
      <Header title="Shop" />
      {/* function prop crossing a server->client boundary: serialization hazard (Ф3 detector case) */}
      <ProductList products={products} />
    </main>
  );
}
