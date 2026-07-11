// No baseUrl in tsconfig, so this bare specifier is NOT a local module — tsc
// treats it as a package. We must agree, and not invent an edge.
import { Leaky } from 'components/Leaky';

export default function Page() {
  return <Leaky />;
}
