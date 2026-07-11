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
        kind={Symbol.for('chart')}
        when={new Date()}
        lookup={new Map()}
        label="hi"
        count={42}
        config={{ a: 1 }}
        buf={new ArrayBuffer(8)}
        bytes={new Uint8Array(8)}
        view={new DataView(new ArrayBuffer(8))}
        form={new FormData()}
        err={new Error('redacted in prod, but does not fail the build')}
        blob={new Blob(['x'])}
        pattern={new RegExp('x')}
        weak={new WeakMap()}
        wset={new WeakSet()}
        url={new URL('https://example.com')}
      />
    </main>
  );
}
