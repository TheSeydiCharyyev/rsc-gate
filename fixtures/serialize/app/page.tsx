import { Client } from '../components/Client';
import { Leaky } from '../components/Leaky';
import { Thing } from '../lib/Thing';

export default function Page() {
  return (
    <main>
      <Leaky />
      <Client
        thing={new Thing(1)}
        sym={Symbol('x')}
        when={new Date()}
        lookup={new Map()}
        label="hi"
        count={42}
        config={{ a: 1 }}
      />
    </main>
  );
}
