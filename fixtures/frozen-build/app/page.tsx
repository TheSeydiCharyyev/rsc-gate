import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { Inline } from '../components/Inline';

export default function Page() {
  return (
    <main>
      <Card title="Frozen" />
      <Badge label="new" />
      <Inline note="co-bundled" />
    </main>
  );
}
