import { Button } from '@acme/ui';
import { format } from '@acme/util';

export default function Page() {
  return <Button onClick={() => format('x')} />;
}
